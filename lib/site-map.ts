/* eslint-disable @typescript-eslint/no-explicit-any */
// 交互地图：不依赖任何框架，命令式渲染“图例 + 高德地图 + 说明”。应用（React）与静态演示页共用同一份。
// 只使用地图渲染、标记、圆、信息窗，不使用需要“安全密钥”的服务插件。所有文字都用 textContent 写入，避免注入。
import type { MapModel } from "./map-model.ts";
import { CLUSTER_MAX_ZOOM, clusterMarkers, type Cluster } from "./map-cluster.ts";

export type MountOptions = {
  key: string | undefined; // 高德 Web 端（JS API）Key
  dark: boolean; // 是否使用深色底图
  fallbackImage?: string; // 交互地图不可用时显示的截图
  forceFallback?: boolean; // 直接显示截图
  allowedHosts?: string[]; // 已在高德白名单里的域名；当前域名不在其中时直接显示截图（高德拒绝域名时页面上无法探测，只能事先判断）
};
export type MountHandle = { destroy: () => void };

const SLOW_MS = 12_000; // 超过这个时间仍未完成加载，提示“较慢”
let loading: Promise<any> | null = null;

// 动态加载高德 JS 地图脚本（整个页面只加载一次）
function loadAMap(key: string): Promise<any> {
  const w = window as any;
  if (w.AMap) return Promise.resolve(w.AMap);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
      s.async = true;
      s.onload = () => (w.AMap ? resolve(w.AMap) : reject(new Error("地图脚本已加载但不可用（请检查 Key 是否有多余字符或已失效）")));
      s.onerror = () => {
        loading = null;
        reject(new Error("地图脚本加载失败"));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// 清理并校验高德 Web 端 Key：去掉首尾空白与引号，必须是 32 位字母数字，否则返回 null。
// 格式不对时高德不会报错，只会返回一个不定义 AMap 的脚本，页面上表现为“脚本已加载但不可用”，所以要在请求前拦住
export function cleanMapKey(raw: string | undefined): string | null {
  const k = (raw ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
  return /^[0-9a-zA-Z]{32}$/.test(k) ? k : null;
}

// 让半径圆刚好放进容器（四周留边距）的缩放级别：Web 墨卡托，256 像素瓦片
export function fitZoom(sizePx: number, radiusM: number, lat: number): number {
  const usable = Math.max(120, sizePx - 60);
  return Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180) * usable) / (2 * radiusM));
}

// 创建元素并设置类名与文字
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// 读取根元素上的 CSS 变量
function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// 在 root 里渲染图例、地图与说明；返回销毁函数
export function mountSiteMap(root: HTMLElement, model: MapModel, opts: MountOptions): MountHandle {
  let destroyed = false;
  let map: any = null;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let drawn: any[] = []; // 当前画在地图上的簇标记，重画前移除
  let redraw: () => void = () => {}; // 地图就绪后替换为真正的重画函数
  const hidden = new Set<string>();

  root.replaceChildren();
  root.classList.add("viz");

  // —— 图例：点击显示/隐藏某一类别 ——
  const legend = el("ul", "viz-legend");
  const buttons: HTMLButtonElement[] = [];
  for (const item of model.legend) {
    const li = el("li");
    const btn = el("button");
    btn.type = "button";
    btn.dataset.fam = item.family;
    btn.setAttribute("aria-pressed", "true");
    btn.disabled = item.markers === 0;
    btn.title = `${item.label}：共 ${item.capped ? "不少于 " : ""}${item.count} 处，地图标出最近的 ${item.markers} 处`;
    const nums = item.markers === item.count ? String(item.markers) : `${item.markers} / ${item.capped ? "≥" : ""}${item.count}`;
    // 宽屏显示完整名称，窄屏显示短名（由 CSS 切换）；读屏与悬停提示始终用完整说明
    btn.setAttribute("aria-label", btn.title);
    btn.append(
      el("span", "viz-badge", item.glyph),
      el("span", "viz-lg-full", `${item.label} ${nums}`),
      el("span", "viz-lg-short", `${item.short} ${nums.replace(/ /g, "")}`),
    );
    (btn.firstChild as HTMLElement).setAttribute("aria-hidden", "true");
    btn.addEventListener("click", () => {
      const nowHidden = !hidden.has(item.key);
      if (nowHidden) hidden.add(item.key);
      else hidden.delete(item.key);
      btn.setAttribute("aria-pressed", String(!nowHidden));
      infoWindow?.close();
      redraw(); // 隐藏的类别不参与聚合，簇随之重算
    });
    li.append(btn);
    legend.append(li);
    buttons.push(btn);
  }

  // —— 地图容器 ——
  const box = el("div", "viz-map-box");
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", "周边设施地图");
  const canvas = el("div", "viz-map-canvas");
  const status = el("div", "viz-status");
  box.append(canvas, status);
  const note = el("p", "viz-note", "点击标记查看详情，相距很近的标记会合并为带数字的圆点，点击即放大拆开；点击图例可隐藏或显示某一类别；图例中“标出数 / 总数”表示地图标出的数量与该类设施总数；地铁站出入口全部标出，其余每类只标出距离最近的至多 10 处。圆为检索范围。");
  root.append(legend, box, note);

  let infoWindow: any = null;

  // 显示截图兜底，并让图例失效
  const showFallback = (reason: string) => {
    if (destroyed) return;
    clearTimeout(slowTimer);
    resizeObserver?.disconnect();
    try {
      map?.destroy();
    } catch {
      /* 忽略销毁失败 */
    }
    map = null;
    canvas.replaceChildren();
    for (const b of buttons) b.disabled = true;
    if (opts.fallbackImage) {
      const img = el("img", "viz-map-img");
      img.src = opts.fallbackImage;
      img.alt = `${model.center.address}周边设施地图截图`;
      canvas.append(img);
      status.textContent = `${reason}，显示截图`;
    } else {
      status.classList.add("is-center"); // 没有截图时把提示放在框中间
      status.textContent = reason;
    }
  };

  // 加载前先判断：没有 Key、不是 http(s) 页面（如双击打开的 file:// 或 data:）、域名不在白名单，都直接显示截图，避免出现无提示的空白地图
  const key = cleanMapKey(opts.key);
  const blocked = !opts.key?.trim()
    ? "未配置地图 Key"
    : !key
      ? "地图 Key 格式不正确（应为 32 位字母数字，请检查环境变量里有没有多余的空格、换行或引号）"
      : !/^https?:$/.test(location.protocol)
      ? "当前打开方式不支持交互地图"
      : opts.allowedHosts && !opts.allowedHosts.includes(location.hostname)
        ? "当前访问域名未获得地图授权"
        : opts.forceFallback
          ? "当前环境不支持交互地图"
          : "";
  if (blocked) {
    showFallback(blocked);
    return { destroy: () => root.replaceChildren() };
  }

  status.textContent = "地图加载中…";
  slowTimer = setTimeout(() => {
    if (!destroyed && status.textContent) status.textContent = "地图加载较慢，请稍候；若一直空白，可能是网络或访问域名未获授权";
  }, SLOW_MS);

  loadAMap(key as string) // Key 缺失或格式不对时上面已经走了兜底分支
    .then((AMap) => {
      if (destroyed) return;
      const center: [number, number] = [model.center.lng, model.center.lat];
      map = new AMap.Map(canvas, {
        zoom: 15,
        center,
        viewMode: "2D",
        resizeEnable: true,
        mapStyle: opts.dark ? "amap://styles/dark" : "amap://styles/normal",
      });
      // 按容器尺寸计算缩放级别，取景到半径圆；不依赖高德的 setFitView（容器尺寸未确定时它会失效）
      const applyFit = () => {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (map && w > 0 && h > 0) map.setZoomAndCenter(fitZoom(Math.min(w, h), model.radius, model.center.lat), center, true);
      };
      let fitted = false;
      map.on("complete", () => {
        clearTimeout(slowTimer);
        if (!destroyed) status.textContent = "";
        applyFit();
      });
      if (typeof ResizeObserver !== "undefined") {
        // 容器第一次有了尺寸时（例如页面在后台创建、之后才显示）再取景一次
        resizeObserver = new ResizeObserver(() => {
          if (!fitted && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
            fitted = true;
            applyFit();
          }
        });
        resizeObserver.observe(canvas);
      }
      // 把当前缩放级别写到容器上，便于调试与自动化测试
      root.dataset.zoom = String(map.getZoom());
      map.on("zoomend", () => {
        if (!destroyed && map) root.dataset.zoom = String(map.getZoom());
      });

      const circle = new AMap.Circle({
        center,
        radius: model.radius,
        strokeColor: cssVar("--viz-ink", "#0b0b0b"),
        strokeOpacity: 0.7,
        strokeWeight: 2,
        strokeStyle: "dashed",
        fillColor: cssVar("--viz-ink", "#0b0b0b"),
        fillOpacity: 0.05,
      });
      map.add(circle);

      const centerEl = el("div", "viz-center");
      centerEl.title = model.center.address;
      // 中心点放在设施标记下面：避免盖住正中间簇的数字（中心位置仍由虚线圆标出）
      map.add(new AMap.Marker({ position: center, content: centerEl, anchor: "center", zIndex: 90 }));

      infoWindow = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -16) });
      const legendByKey = new Map(model.legend.map((l) => [l.key, l]));

      // 簇的外观：单点 = 原来的标记；同类多点 = 该类标记 + 数量角标；多类 = 中性圆点写总数 + 小色点表示含有哪几类
      const clusterEl = (c: Cluster): HTMLElement => {
        const first = c.members[0];
        if (c.categories.length === 1) {
          const pin = el("div", "viz-pin", first.glyph);
          pin.dataset.fam = first.family;
          if (c.members.length > 1) pin.append(el("span", "viz-count", String(c.members.length)));
          pin.title = c.members.length === 1 ? `${first.name}（${first.category}，${first.distanceM} m）` : `${first.category} ${c.members.length} 处，点击放大`;
          return pin;
        }
        const box = el("div", "viz-cluster", String(c.members.length));
        const dots = el("span", "viz-dots");
        for (const k of c.categories.slice(0, 3)) {
          const d = el("span", "viz-dot");
          d.dataset.fam = legendByKey.get(k)?.family ?? "";
          dots.append(d);
        }
        box.append(dots);
        box.title = c.categories.map((k) => `${legendByKey.get(k)?.label ?? k} ${c.members.filter((m) => m.categoryKey === k).length}`).join("、") + "，点击放大";
        return box;
      };

      // 簇内设施列表（已放到最大仍重叠时用）
      const listInfo = (c: Cluster) => {
        const info = el("div", "viz-info");
        info.append(el("strong", undefined, `此处 ${c.members.length} 处设施`));
        const ul = el("ul", "viz-info-list");
        for (const m of [...c.members].sort((a, b) => a.distanceM - b.distanceM).slice(0, 12)) ul.append(el("li", undefined, `${m.name} · ${m.category} · ${m.distanceM} m`));
        info.append(ul);
        if (c.members.length > 12) info.append(el("div", undefined, `等 ${c.members.length} 处`));
        return info;
      };

      redraw = () => {
        if (destroyed || !map) return;
        if (drawn.length) map.remove(drawn);
        drawn = [];
        const zoom = map.getZoom();
        for (const c of clusterMarkers(model.markers, zoom, { hidden })) {
          const marker = new AMap.Marker({ position: [c.lng, c.lat], content: clusterEl(c), anchor: "center", zIndex: 100 + Math.min(c.members.length, 50) });
          marker.on("click", () => {
            if (c.members.length === 1) {
              const m = c.members[0];
              const info = el("div", "viz-info");
              info.append(el("strong", undefined, m.name), document.createTextNode(`${m.category} · ${m.distanceM} m`));
              infoWindow.setContent(info);
              infoWindow.open(map, [m.lng, m.lat]);
            } else if (map.getZoom() < CLUSTER_MAX_ZOOM) {
              infoWindow.close();
              map.setZoomAndCenter(Math.min(Math.floor(map.getZoom()) + 2, CLUSTER_MAX_ZOOM), [c.lng, c.lat]);
            } else {
              infoWindow.setContent(listInfo(c));
              infoWindow.open(map, [c.lng, c.lat]);
            }
          });
          drawn.push(marker);
        }
        map.add(drawn);
        root.dataset.symbols = String(drawn.length); // 便于调试与自动化测试
      };
      map.on("zoomend", () => redraw());
      redraw();
      applyFit();
    })
    .catch((err: Error) => showFallback(err.message));

  return {
    destroy: () => {
      destroyed = true;
      clearTimeout(slowTimer);
      resizeObserver?.disconnect();
      try {
        map?.destroy();
      } catch {
        /* 忽略销毁失败 */
      }
      root.replaceChildren();
    },
  };
}
