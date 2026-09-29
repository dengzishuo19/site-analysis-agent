// 大模型调用封装（OpenAI 兼容格式）：只在服务端使用，换模型只需改环境变量

export type ChatOptions = {
  system?: string; // 系统提示词
  temperature?: number; // 采样温度，越低越稳定
  timeoutMs?: number; // 超时毫秒数
};

// 当前使用的模型名
export function modelName(): string {
  return process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
}

// 向大模型发送一段提示词，返回文字回答
export async function chat(prompt: string, options: ChatOptions = {}): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("未配置 DEEPSEEK_API_KEY，请检查 .env.local");

  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const messages = [
    ...(options.system ? [{ role: "system", content: options.system }] : []),
    { role: "user", content: prompt },
  ];

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: modelName(),
      messages,
      temperature: options.temperature ?? 0.3,
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`大模型接口 HTTP 错误：${res.status} ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("大模型返回内容为空");
  return text;
}
