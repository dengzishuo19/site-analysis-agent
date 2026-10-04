import { AddressNotFoundError, NonMainlandError, RateLimitError, geocodeAll, searchKeywordFull } from "@/lib/amap";
import { buildCandidates, candidatesFromGeocodes, classifyGeocode, mergeCandidates, parseCityHint, topIsNonMainland, type Candidate } from "@/lib/geo-resolve";
import { rateLimit } from "@/lib/guard";
import { sanitizeAddress } from "@/lib/input";
import { decodePick, encodePick } from "@/lib/pick-token";
import { resolveSecret, signPayload } from "@/lib/sign";
import { analyzeCenter } from "@/lib/stats";

export const maxDuration = 60; // 7 类设施依次检索，通常需要 10 到 15 秒

// 去掉错误信息里可能出现的 Key，防止泄露到前端
function safeMessage(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  for (const secret of [process.env.AMAP_WEB_KEY, process.env.SIGNING_SECRET]) {
    if (secret) msg = msg.split(secret).join("***");
  }
  return msg;
}

// 对一个已定位的中心点做统计，并给结果签名
async function analyzeAndSign(center: { address: string; lng: number; lat: number }, secret: string) {
  const stats = await analyzeCenter(center);
  return Response.json({ ...stats, ...signPayload(stats, secret, Date.now()) });
}

// 把候选连同各自的签名令牌返回给浏览器，用户选中后凭令牌继续分析
function chooseResponse(reason: string, query: string, candidates: Candidate[], secret: string) {
  return Response.json({
    kind: "choose",
    reason,
    query,
    candidates: candidates.map((c) => ({
      name: c.name,
      district: c.district,
      region: c.region,
      address: c.address,
      type: c.type,
      pick: encodePick({ name: c.name, lng: c.lng, lat: c.lat }, secret, Date.now()),
    })),
  });
}

// 场地分析接口：
//   GET /api/site?address=…  输入地址（全国，中国大陆；可在前面加城市名并用空格隔开，如“上海 人民广场”）；
//                            定位够具体则直接分析，含糊则返回候选，太宽泛则拒绝
//   GET /api/site?pick=…     选择候选：只接受服务器签发的令牌，不接受浏览器提交的坐标
export async function GET(request: Request) {
  const limited = rateLimit(request, "site");
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const pick = params.get("pick");

  try {
    const secret = resolveSecret(process.env); // 先取密钥：缺失时立即失败，不消耗高德额度

    if (pick !== null) {
      const decoded = decodePick(pick, secret, Date.now());
      if (!decoded.ok) {
        const map = {
          malformed: [400, "候选令牌格式不正确，请重新输入地址"],
          outside: [400, "该地点不在支持的范围内（中国大陆）"],
          expired: [403, "候选已过期，请重新输入地址"],
          invalid: [403, "候选令牌无效，请重新输入地址"],
        } as const;
        const [status, error] = map[decoded.reason];
        return Response.json({ error }, { status });
      }
      return await analyzeAndSign({ address: decoded.payload.name, lng: decoded.payload.lng, lat: decoded.payload.lat }, secret);
    }

    const input = sanitizeAddress(params.get("address"));
    if (!input.ok) {
      return Response.json({ error: input.error }, { status: 400 });
    }

    const hint = parseCityHint(input.value);
    const hits = await geocodeAll(hint.query, hint.city);
    const result = classifyGeocode(hint.query, hits);

    if (result.status === "reject") {
      return Response.json({ error: result.message }, { status: 422 });
    }
    if (result.status === "ok") {
      return await analyzeAndSign({ address: result.pick.formatted, lng: result.pick.lng, lat: result.pick.lat }, secret);
    }

    // 定位含糊：先用关键字搜索给候选（高德按知名度排序，全国同名时更符合直觉，如“人民广场”上海排第一）；
    // 关键字搜索没有可用的顶层点位时，退回地理编码的命中
    const { pois, suggestCities } = await searchKeywordFull(hint.query, hint.city);
    if (topIsNonMainland(pois)) {
      return Response.json({ error: "暂不支持港澳台地区：高德在这些地区的设施点位覆盖不完整，统计会明显偏少" }, { status: 422 });
    }
    // 用户已指定城市时，关键字结果都在该城市，按知名度取前几个即可；未指定城市时保证多个城市都能出现
    const fromKeyword = buildCandidates(pois);
    const candidates = hint.city
      ? mergeCandidates(fromKeyword, [], Number.POSITIVE_INFINITY) // 同一城市内只去掉相距很近的重复
      : mergeCandidates(fromKeyword, result.reason === "multiple" ? candidatesFromGeocodes(result.geocodes) : []);
    if (!candidates.length) {
      const example = suggestCities[0] ? `例如：${suggestCities[0].replace(/市$/, "")} ${hint.query}` : "例如：上海 人民广场";
      return Response.json({ error: `“${input.value}”在多个城市都有或无法确定具体位置，请在前面加上城市名并用空格隔开，${example}` }, { status: 404 });
    }
    if (candidates.length === 1 && result.reason !== "multiple") {
      const only = candidates[0]; // 只有一个顶层地点，无需再让用户选择
      return await analyzeAndSign({ address: only.name, lng: only.lng, lat: only.lat }, secret);
    }
    return chooseResponse(result.reason, input.value, candidates, secret);
  } catch (err) {
    if (err instanceof NonMainlandError) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof AddressNotFoundError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof RateLimitError) {
      return Response.json({ error: err.message }, { status: 429 });
    }
    // 访问高德时的网络瞬时失败或超时：给出友好提示，而不是生硬的 “fetch failed”
    if ((err instanceof TypeError && /fetch failed/i.test(err.message)) || (err instanceof Error && err.name === "TimeoutError")) {
      return Response.json({ error: "地图服务暂时没有响应，请稍后重试" }, { status: 503 });
    }
    return Response.json({ error: safeMessage(err) }, { status: 500 });
  }
}
