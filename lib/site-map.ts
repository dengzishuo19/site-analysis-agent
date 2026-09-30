/* eslint-disable @typescript-eslint/no-explicit-any */
// 交互地图：不依赖任何框架，命令式渲染“图例 + 高德地图 + 说明”。应用（React）与静态演示页共用同一份。
// 只使用地图渲染、标记、圆、信息窗，不使用需要“安全密钥”的服务插件。所有文字都用 textContent 写入，避免注入。
import type { MapModel } from "./map-model.ts";

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
      s.onload = () => (w.AMap ? resolve(w.AMap) : reject(new Error("地图脚本已加载但不可用")));
      s.onerror = () => {
        loading = null;
        reject(new Error("地图脚本加载失败"));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
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
  const markersByCat = new Map<string, any[]>();
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
    btn.append(el("span", "viz-badge", item.glyph), document.createTextNode(`${item.label} ${item.markers}`));
    (btn.firstChild as HTMLElement).setAttribute("aria-hidden", "true");
    btn.addEventListener("click", () => {
      const nowHidden = !hidden.has(item.key);
      if (nowHidden) hidden.add(item.key);
      else hidden.delete(item.key);
      btn.setAttribute("aria-pressed", String(!nowHidden));
      for (const m of markersByCat.get(item.key) ?? []) nowHidden ? m.hide() : m.show();
      infoWindow?.close();
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
  const note = el("p", "viz-note", "点击标记查看详情，点击图例可隐藏或显示某一类别；每类只标出距离最近的至多 10 处设施。圆为检索范围。");
  root.append(legend, box, note);

  let infoWindow: any = null;

  // 显示截图兜底，并让图例失效
  const showFallback = (reason: string) => {
    if (destroyed) return;
    clearTimeout(slowTimer);
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
      status.textContent = reason;
    }
  };

  // 加载前先判断：没有 Key、不是 http(s) 页面（如双击打开的 file:// 或 data:）、域名不在白名单，都直接显示截图，避免出现无提示的空白地图
  const blocked = !opts.key
    ? "未配置地图 Key"
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

  loadAMap(opts.key as string) // 没有 Key 时上面已经走了兜底分支
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
      map.on("complete", () => {
        clearTimeout(slowTimer);
        if (!destroyed) status.textContent = "";
      });
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
      map.add(new AMap.Marker({ position: center, content: centerEl, anchor: "center", zIndex: 200 }));

      infoWindow = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -16) });
      for (const m of model.markers) {
        const pin = el("div", "viz-pin", m.glyph);
        pin.dataset.fam = m.family;
        pin.title = `${m.name}（${m.category}，${m.distanceM} m）`;
        const marker = new AMap.Marker({ position: [m.lng, m.lat], content: pin, anchor: "center", zIndex: 100 });
        marker.on("click", () => {
          const info = el("div", "viz-info");
          info.append(el("strong", undefined, m.name), document.createTextNode(`${m.category} · ${m.distanceM} m`));
          infoWindow.setContent(info);
          infoWindow.open(map, [m.lng, m.lat]);
        });
        map.add(marker);
        const list = markersByCat.get(m.categoryKey) ?? [];
        list.push(marker);
        markersByCat.set(m.categoryKey, list);
      }
      map.setFitView([circle], true, [30, 30, 30, 30]);
    })
    .catch((err: Error) => showFallback(err.message));

  return {
    destroy: () => {
      destroyed = true;
      clearTimeout(slowTimer);
      try {
        map?.destroy();
      } catch {
        /* 忽略销毁失败 */
      }
      root.replaceChildren();
    },
  };
}
