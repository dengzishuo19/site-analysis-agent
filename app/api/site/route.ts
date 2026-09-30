import { AddressNotFoundError, RateLimitError, geocodeAll, searchKeyword } from "@/lib/amap";
import { buildCandidates, candidatesFromGeocodes, classifyGeocode, type Candidate } from "@/lib/geo-resolve";
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
      address: c.address,
      type: c.type,
      pick: encodePick({ name: c.name, lng: c.lng, lat: c.lat }, secret, Date.now()),
    })),
  });
}

// 场地分析接口：
//   GET /api/site?address=…  输入地址；定位够具体则直接分析，含糊则返回候选，太宽泛则拒绝
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
          outside: [400, "该地点不在北京范围内"],
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

    const hits = await geocodeAll(input.value);
    const result = classifyGeocode(input.value, hits);

    if (result.status === "reject") {
      return Response.json({ error: result.message }, { status: 422 });
    }
    if (result.status === "ok") {
      return await analyzeAndSign({ address: result.pick.formatted, lng: result.pick.lng, lat: result.pick.lat }, secret);
    }

    // 定位含糊：多个相距很远的候选用地理编码的命中；高德没认出具体地点时改用关键字搜索
    const candidates =
      result.reason === "multiple" ? candidatesFromGeocodes(result.geocodes) : buildCandidates(await searchKeyword(input.value));
    if (!candidates.length) {
      return Response.json({ error: `未找到“${input.value}”对应的具体地点，请输入更具体的名称` }, { status: 404 });
    }
    if (candidates.length === 1 && result.reason !== "multiple") {
      const only = candidates[0]; // 只有一个顶层地点，无需再让用户选择
      return await analyzeAndSign({ address: only.name, lng: only.lng, lat: only.lat }, secret);
    }
    return chooseResponse(result.reason, input.value, candidates, secret);
  } catch (err) {
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
