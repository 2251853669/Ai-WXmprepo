import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const GENERATED_IMAGE_DIR = path.join(PUBLIC_DIR, "generated-images");

const providerTemplates = [
  {
    key: "openai",
    name: "OpenAI",
    type: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  },
  {
    key: "deepseek",
    name: "DeepSeek",
    type: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat"
  },
  {
    key: "kimi",
    name: "Kimi",
    type: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k"
  },
  {
    key: "gemini",
    name: "Gemini",
    type: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-1.5-flash"
  },
  {
    key: "qwen",
    name: "通义千问",
    type: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus"
  },
  {
    key: "zhipu",
    name: "智谱 GLM",
    type: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash"
  },
  {
    key: "anthropic",
    name: "Claude",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-haiku-latest"
  },
  {
    key: "openrouter",
    name: "OpenRouter",
    type: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini"
  },
  {
    key: "siliconflow",
    name: "SiliconFlow",
    type: "openai-compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3"
  },
  {
    key: "custom-compatible",
    name: "自定义中转 API",
    type: "openai-compatible",
    baseUrl: "https://your-proxy.example.com/v1",
    model: "gpt-4o-mini"
  }
];

const imageProviderTemplates = [
  {
    key: "openai-image",
    name: "OpenAI 图片",
    type: "openai-image-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    size: "1024x1024"
  },
  {
    key: "custom-image-compatible",
    name: "自定义图片中转",
    type: "openai-image-compatible",
    baseUrl: "https://your-image-proxy.example.com/v1",
    model: "",
    size: "1024x1024"
  }
];

const defaultState = {
  settings: {
    workspaceName: "AI 工具运营台",
    defaultProvider: "",
    defaultAuthor: "",
    audience: "关注 AI 工具、Mac 效率、开发实践和软件生产力的读者",
    tone: "专业、克制、实用，避免夸张标题党",
    categories: ["AI 工具", "Mac 正版软件与开源替代", "开发", "软件分享"],
    providers: [],
    defaultImageProvider: "",
    imageProviders: [],
    publishing: {
      webhookUrl: "",
      wechatAppId: "",
      wechatAppSecret: "",
      defaultThumbMediaId: "",
      contentSourceUrl: "",
      autoPublishEnabled: false
    }
  },
  ideas: [],
  articles: [],
  jobs: []
};

const riskyTerms = [
  "破解版下载",
  "破解下载",
  "注册机",
  "激活码",
  "序列号",
  "免激活",
  "绕过授权",
  "盗版资源",
  "crack download",
  "keygen",
  "license bypass",
  "serial key"
];

const sensitiveTopicTerms = ["破解", "破解版", "盗版", "crack", "keygen"];

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

async function ensureStore() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(GENERATED_IMAGE_DIR, { recursive: true });
  if (!existsSync(STORE_FILE)) {
    await writeFile(STORE_FILE, JSON.stringify(defaultState, null, 2));
  }
}

async function loadState() {
  await ensureStore();
  const raw = await readFile(STORE_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return {
    ...defaultState,
    ...parsed,
    settings: {
      ...defaultState.settings,
      ...(parsed.settings || {}),
      providers: mergeProviders(parsed.settings?.providers || []),
      imageProviders: mergeImageProviders(parsed.settings?.imageProviders || [])
    }
  };
}

function mergeProviders(existing) {
  return existing.map((provider) => sanitizeProvider(provider)).filter((provider) => provider.name && provider.baseUrl);
}

function sanitizeProvider(provider) {
  const idValue = String(provider.id || id("provider")).replace(/[^a-zA-Z0-9_-]/g, "_");
  const type = ["openai-compatible", "gemini", "anthropic"].includes(provider.type)
    ? provider.type
    : "openai-compatible";
  return {
    id: idValue,
    name: String(provider.name || "中转 API"),
    type,
    baseUrl: String(provider.baseUrl || ""),
    model: String(provider.model || ""),
    apiKey: String(provider.apiKey || ""),
    templateKey: String(provider.templateKey || provider.id || "custom-compatible"),
    models: Array.isArray(provider.models)
      ? provider.models.slice(0, 300).map((model) => ({
          id: String(model.id || model.name || ""),
          name: String(model.name || model.id || "")
        })).filter((model) => model.id)
      : []
  };
}

function mergeImageProviders(existing) {
  return existing.map((provider) => sanitizeImageProvider(provider)).filter((provider) => provider.name && provider.baseUrl);
}

function sanitizeImageProvider(provider) {
  const idValue = String(provider.id || id("image_provider")).replace(/[^a-zA-Z0-9_-]/g, "_");
  const type = ["openai-image-compatible"].includes(provider.type) ? provider.type : "openai-image-compatible";
  return {
    id: idValue,
    name: String(provider.name || "图片模型"),
    type,
    baseUrl: String(provider.baseUrl || ""),
    model: String(provider.model || ""),
    apiKey: String(provider.apiKey || ""),
    size: String(provider.size || "1024x1024"),
    templateKey: String(provider.templateKey || provider.id || "custom-image-compatible"),
    models: Array.isArray(provider.models)
      ? provider.models.slice(0, 300).map((model) => ({
          id: String(model.id || model.name || ""),
          name: String(model.name || model.id || "")
        })).filter((model) => model.id)
      : []
  };
}

async function saveState(state) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(state, null, 2));
}

function publicState(state) {
  return {
    ...state,
    providerTemplates,
    imageProviderTemplates,
    settings: {
      ...state.settings,
      providers: state.settings.providers.map((provider) => ({
        ...provider,
        apiKey: provider.apiKey ? "********" : ""
      })),
      imageProviders: state.settings.imageProviders.map((provider) => ({
        ...provider,
        apiKey: provider.apiKey ? "********" : ""
      })),
      publishing: {
        ...state.settings.publishing,
        wechatAppSecret: state.settings.publishing.wechatAppSecret ? "********" : ""
      }
    }
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendJsonDownload(res, filename, payload) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function readRequestBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readMultipartFile(req) {
  const contentType = req.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) throw new Error("没有找到上传边界，请选择图片文件上传。");

  const body = await readRequestBuffer(req);
  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const partStart = cursor + delimiter.length + 2;
    const next = body.indexOf(delimiter, partStart);
    if (next === -1) break;
    const part = body.subarray(partStart, next - 2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const content = part.subarray(headerEnd + 4);
      const disposition = headers.match(/content-disposition:\s*([^\r\n]+)/i)?.[1] || "";
      const fieldName = disposition.match(/name="([^"]+)"/)?.[1] || "";
      const filename = disposition.match(/filename="([^"]*)"/)?.[1] || "";
      const mimeType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "application/octet-stream";
      if ((fieldName === "media" || fieldName === "file") && filename && content.length) {
        return { filename, mimeType, buffer: content };
      }
    }
    cursor = next;
  }
  throw new Error("没有读取到图片文件。");
}

function hasRiskyInstruction(text = "") {
  const normalized = text.toLowerCase();
  return riskyTerms.some((term) => {
    const needle = term.toLowerCase();
    let index = normalized.indexOf(needle);
    while (index !== -1) {
      const context = normalized.slice(Math.max(0, index - 14), index + needle.length + 10);
      if (!/(不提供|不会提供|拒绝|禁止|避免|不要|不能|不应|风险|安全|合规|替代)/.test(context)) {
        return true;
      }
      index = normalized.indexOf(needle, index + needle.length);
    }
    return false;
  });
}

function hasSensitiveTopic(text = "") {
  const normalized = text.toLowerCase();
  return sensitiveTopicTerms.some((term) => normalized.includes(term.toLowerCase()));
}

function normalizeTopic(topic = "") {
  if (!hasSensitiveTopic(topic)) return { topic, rewritten: false };
  return {
    topic: topic
      .replaceAll("苹果破解软件", "Mac 正版软件、开源替代与安全风险")
      .replaceAll("破解软件", "软件正版替代与安全风险")
      .replaceAll("破解版", "非官方版本风险")
      .replaceAll("破解", "授权合规")
      .replaceAll("盗版", "版权风险"),
    rewritten: true
  };
}

function complianceReport(text = "") {
  const blocked = hasRiskyInstruction(text);
  const sensitive = hasSensitiveTopic(text);
  return {
    status: blocked ? "blocked" : sensitive ? "review" : "clear",
    message: blocked
      ? "内容包含破解下载、绕过授权或盗版资源导向，已阻止发布。"
      : sensitive
        ? "内容涉及敏感软件授权话题，建议只保留风险提示、正版优惠或开源替代。"
        : "合规检查通过。"
  };
}

function providerFor(settings, providerId) {
  const idToFind = providerId || settings.defaultProvider;
  return settings.providers.find((provider) => provider.id === idToFind) || settings.providers[0];
}

async function callModel(settings, providerId, messages, options = {}) {
  const provider = providerFor(settings, providerId);
  if (!provider?.apiKey) return null;

  if (provider.type === "gemini") {
    return callGemini(provider, messages, options);
  }

  if (provider.type === "anthropic") {
    return callAnthropic(provider, messages, options);
  }

  return callOpenAICompatible(provider, messages, options);
}

async function callOpenAICompatible(provider, messages, options) {
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: options.temperature ?? 0.7,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {})
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `模型请求失败：${response.status}`);
  }
  return data.choices?.[0]?.message?.content || "";
}

async function callGemini(provider, messages, options) {
  const prompt = messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
  const response = await fetch(
    `${provider.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          ...(options.maxTokens ? { maxOutputTokens: options.maxTokens } : {})
        }
      })
    }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini 请求失败：${response.status}`);
  }
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "";
}

async function callAnthropic(provider, messages, options) {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const userMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    }));
  const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: provider.model,
      system,
      messages: userMessages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.7
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Claude 请求失败：${response.status}`);
  }
  return data.content?.map((part) => part.text || "").join("") || "";
}

function providerFromInput(state, input) {
  const raw = input.provider || input;
  const existing = raw.id ? state.settings.providers.find((provider) => provider.id === raw.id) : null;
  const provider = sanitizeProvider({ ...(existing || {}), ...raw });
  if (provider.apiKey === "********") {
    provider.apiKey = existing?.apiKey || "";
  }
  return provider;
}

function imageProviderFor(settings, providerId) {
  const idToFind = providerId || settings.defaultImageProvider;
  return settings.imageProviders.find((provider) => provider.id === idToFind) || settings.imageProviders[0];
}

function imageProviderFromInput(state, input) {
  const raw = input.provider || input;
  const existing = raw.id ? state.settings.imageProviders.find((provider) => provider.id === raw.id) : null;
  const provider = sanitizeImageProvider({ ...(existing || {}), ...raw });
  if (provider.apiKey === "********") {
    provider.apiKey = existing?.apiKey || "";
  }
  return provider;
}

async function fetchProviderModels(provider) {
  if (!provider.apiKey) throw new Error("请先填写 API Key。");

  if (provider.type === "gemini") {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/models?key=${encodeURIComponent(provider.apiKey)}`);
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data?.error?.message || `拉取 Gemini 模型失败：${response.status}`);
    }
    return (data.models || [])
      .filter((model) => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes("generateContent"))
      .map((model) => ({
        id: String(model.name || "").replace(/^models\//, ""),
        name: String(model.displayName || model.name || "").replace(/^models\//, "")
      }))
      .filter((model) => model.id);
  }

  if (provider.type === "anthropic") {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/models`, {
      headers: {
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01"
      }
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data?.error?.message || `拉取 Claude 模型失败：${response.status}`);
    }
    return (data.data || []).map((model) => ({
      id: String(model.id || model.name || ""),
      name: String(model.display_name || model.id || model.name || "")
    })).filter((model) => model.id);
  }

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/models`, {
    headers: { authorization: `Bearer ${provider.apiKey}` }
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data?.error?.message || `拉取模型列表失败：${response.status}`);
  }
  return (data.data || data.models || [])
    .map((model) => ({
      id: String(typeof model === "string" ? model : model.id || model.name || ""),
      name: String(typeof model === "string" ? model : model.display_name || model.name || model.id || "")
    }))
    .filter((model) => model.id);
}

async function testProviderModel(provider) {
  if (!provider.apiKey) throw new Error("请先填写 API Key。");
  if (!provider.model) throw new Error("请先选择或填写模型名。");
  const content = await callModel(
    { providers: [provider], defaultProvider: provider.id },
    provider.id,
    [
      {
        role: "user",
        content: "请只回复 OK，用于测试模型连接。"
      }
    ],
    { temperature: 0, maxTokens: 20 }
  );
  return String(content || "").trim();
}

async function callImageModel(settings, providerId, prompt, article, image, index) {
  const provider = imageProviderFor(settings, providerId);
  if (!provider?.apiKey || !provider.model || !provider.baseUrl) return null;

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/images/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      prompt,
      n: 1,
      size: provider.size || "1024x1024"
    })
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data?.error?.message || `图片模型请求失败：${response.status}`);
  }

  const result = data.data?.[0];
  if (result?.b64_json) {
    return saveGeneratedImageBuffer(article, image, index, Buffer.from(result.b64_json, "base64"), "png");
  }
  if (result?.url) {
    return result.url;
  }
  throw new Error("图片模型没有返回图片 URL 或 b64_json。");
}

async function testImageProviderModel(provider) {
  if (!provider.apiKey) throw new Error("请先填写图片模型 API Key。");
  if (!provider.model) throw new Error("请先填写图片模型名。");
  const mockArticle = {
    id: id("image_test"),
    title: "图片模型测试",
    category: "AI 工具",
    digest: "图片模型连通性测试"
  };
  const image = {
    type: "test",
    title: "图片模型测试",
    alt: "图片模型测试图",
    prompt: "A simple clean editorial test image, abstract productivity tools, no text"
  };
  const url = await callImageModel(
    { imageProviders: [provider], defaultImageProvider: provider.id },
    provider.id,
    image.prompt,
    mockArticle,
    image,
    0
  );
  return url;
}

async function fetchImageProviderModels(provider) {
  if (!provider.apiKey) throw new Error("请先填写图片模型 API Key。");
  if (!provider.baseUrl) throw new Error("请先填写图片模型 Base URL。");

  const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/models`, {
    headers: { authorization: `Bearer ${provider.apiKey}` }
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data?.error?.message || `拉取图片模型列表失败：${response.status}`);
  }
  return (data.data || data.models || [])
    .map((model) => ({
      id: String(typeof model === "string" ? model : model.id || model.name || ""),
      name: String(typeof model === "string" ? model : model.display_name || model.name || model.id || "")
    }))
    .filter((model) => model.id);
}

function parseModelJson(text, fallback) {
  if (!text) return fallback;
  const trimmed = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstObject = Math.min(...["{", "["].map((char) => {
      const index = trimmed.indexOf(char);
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    }));
    if (!Number.isFinite(firstObject)) return fallback;
    const sliced = trimmed.slice(firstObject);
    try {
      return JSON.parse(sliced);
    } catch {
      return fallback;
    }
  }
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractArticleFromHtml(html = "", url = "") {
  const title =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    "";
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    "";
  const articleMatch =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const source = articleMatch?.[1] || html;
  const text = stripHtml(source);
  return {
    url,
    title: stripHtml(title),
    description: stripHtml(description),
    text: text.slice(0, 12000)
  };
}

async function fetchExternalArticle(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("外部链接格式不正确。");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("只支持 http/https 外部链接。");
  }
  const response = await fetch(parsedUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 WeChatOpsConsole/1.0",
      accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`读取外部文章失败：${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error("外部链接不是可读取的 HTML 文章。");
  }
  const html = await response.text();
  const article = extractArticleFromHtml(html, parsedUrl.toString());
  if (article.text.length < 200) {
    throw new Error("没有从外部链接中提取到足够正文，可能需要登录或页面不支持抓取。");
  }
  return article;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeXml(value = "") {
  return escapeHtml(value);
}

function safeImageUrl(url = "") {
  const value = String(url).trim();
  if (/^https?:\/\//i.test(value)) return escapeHtml(value);
  if (value.startsWith("/generated-images/")) return escapeHtml(value);
  return "";
}

function shortText(value = "", max = 34) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function imagePalette(category = "") {
  const key = category.length ? category.charCodeAt(0) % 4 : 0;
  return [
    ["#0f5c4e", "#d9a632", "#eaf4f0"],
    ["#304c89", "#35a7a0", "#eef3ff"],
    ["#7a4e13", "#2f7d59", "#fff4df"],
    ["#5d4777", "#c87941", "#f4eff8"]
  ][key];
}

async function createEditorialSvg(article, image, index) {
  await mkdir(GENERATED_IMAGE_DIR, { recursive: true });
  const [primary, accent, paper] = imagePalette(article.category);
  const filename = `${article.id}-${image.type}-${index}.svg`;
  const filePath = path.join(GENERATED_IMAGE_DIR, filename);
  const label = image.type === "cover" ? "COVER" : "INSIGHT";
  const title = escapeXml(shortText(image.title || article.title, image.type === "cover" ? 36 : 30));
  const subtitle = escapeXml(shortText(image.alt || article.digest || article.category, 62));
  const category = escapeXml(shortText(article.category || "AI 工具", 18));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="${subtitle}">
  <rect width="1200" height="675" fill="${paper}"/>
  <rect x="58" y="58" width="1084" height="559" rx="32" fill="#ffffff"/>
  <rect x="58" y="58" width="1084" height="120" rx="32" fill="${primary}"/>
  <rect x="58" y="126" width="1084" height="52" fill="${primary}"/>
  <circle cx="994" cy="238" r="150" fill="${accent}" opacity="0.18"/>
  <circle cx="1050" cy="506" r="92" fill="${primary}" opacity="0.12"/>
  <rect x="112" y="102" width="142" height="42" rx="21" fill="${accent}"/>
  <text x="183" y="130" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#18201d">${label}</text>
  <text x="112" y="266" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="800" fill="#18201d">${title}</text>
  <text x="112" y="332" font-family="Arial, Helvetica, sans-serif" font-size="27" fill="#5d6b66">${subtitle}</text>
  <g transform="translate(112 420)">
    <rect width="236" height="86" rx="16" fill="${primary}" opacity="0.95"/>
    <rect x="270" width="236" height="86" rx="16" fill="${accent}" opacity="0.95"/>
    <rect x="540" width="236" height="86" rx="16" fill="#18201d" opacity="0.9"/>
    <text x="34" y="53" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#ffffff">AI WORKFLOW</text>
    <text x="304" y="53" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#18201d">TOOLS</text>
    <text x="574" y="53" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${category}</text>
  </g>
  <path d="M820 392h210M820 436h150M820 480h245" stroke="${primary}" stroke-width="16" stroke-linecap="round" opacity="0.28"/>
</svg>`;
  await writeFile(filePath, svg);
  return `/generated-images/${filename}`;
}

async function saveGeneratedImageBuffer(article, image, index, buffer, ext) {
  await mkdir(GENERATED_IMAGE_DIR, { recursive: true });
  const safeExt = String(ext || "png").replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
  const filename = `${article.id}-${image.type}-${index}.${safeExt}`;
  const filePath = path.join(GENERATED_IMAGE_DIR, filename);
  await writeFile(filePath, buffer);
  return `/generated-images/${filename}`;
}

function imageMarkdown(image) {
  return `![${image.alt}](${image.url})`;
}

function contentHasImages(content = "") {
  return /!\[[^\]]*]\([^)]+\)/.test(content);
}

function headingCount(content = "") {
  return (content.match(/^##\s+/gm) || []).length;
}

function fallbackImagePlan(article) {
  const count = Math.min(3, Math.max(0, Math.ceil(Math.max(headingCount(article.content) - 1, 0) / 2)));
  const inlineSeeds = [
    {
      title: "核心判断",
      alt: "工具选择、效率评估和安全检查示意图",
      prompt: "Editorial illustration for tool selection, productivity evaluation, and security checklist"
    },
    {
      title: "工作流落地",
      alt: "AI 工具接入内容运营工作流示意图",
      prompt: "Editorial illustration for AI tools integrated into content operations workflow"
    },
    {
      title: "复盘与迭代",
      alt: "内容运营数据复盘和工具迭代示意图",
      prompt: "Editorial illustration for content operations analytics and workflow iteration"
    }
  ];
  return [
    {
      type: "cover",
      title: article.title,
      alt: `${article.title} 封面图`,
      prompt: article.coverPrompt
    },
    ...inlineSeeds.slice(0, count).map((image) => ({ ...image, type: "inline" }))
  ];
}

function normalizeImagePlan(article, plan) {
  const raw = Array.isArray(plan) && plan.length ? plan : fallbackImagePlan(article);
  const cleaned = raw
    .map((image, index) => ({
      type: image.type === "cover" && index === 0 ? "cover" : "inline",
      title: String(image.title || (index === 0 ? article.title : `配图 ${index}`)),
      alt: String(image.alt || image.title || `${article.title} 配图`),
      prompt: String(image.prompt || image.description || article.coverPrompt || article.title),
      afterHeading: String(image.afterHeading || "")
    }))
    .filter((image) => image.prompt && image.alt);
  if (!cleaned.some((image) => image.type === "cover")) {
    cleaned.unshift({
      type: "cover",
      title: article.title,
      alt: `${article.title} 封面图`,
      prompt: article.coverPrompt || article.title,
      afterHeading: ""
    });
  }
  return cleaned.slice(0, 5);
}

async function createArticleImage(state, article, image, index, imageProviderId) {
  const prompt = `${image.prompt}

Style: editorial bitmap for WeChat article, clean composition, realistic software/productivity workspace, no text, no logos, safe for publication.
Article: ${article.title}
Category: ${article.category}`;
  try {
    const url = await callImageModel(state.settings, imageProviderId, prompt, article, image, index);
    if (url) return { url, source: "model" };
  } catch (error) {
    image.error = error.message;
  }
  return {
    url: await createEditorialSvg(article, image, index),
    source: "svg-fallback"
  };
}

function insertImagesIntoContent(content, images) {
  if (contentHasImages(content)) return content;
  const blocks = content.split(/\n{2,}/);
  const cover = images.find((image) => image.type === "cover");
  const inlineImages = images.filter((image) => image.type !== "cover");
  const decorated = cover ? [imageMarkdown(cover), ...blocks] : [...blocks];

  for (const [index, image] of inlineImages.entries()) {
    let insertAt = Math.min(decorated.length, 3 + index * 3);
    if (image.afterHeading) {
      const headingIndex = decorated.findIndex((block) => block.trim().replace(/^##\s+/, "") === image.afterHeading);
      if (headingIndex !== -1) insertAt = Math.min(decorated.length, headingIndex + 2);
    }
    decorated.splice(insertAt, 0, imageMarkdown(image));
  }
  return decorated.join("\n\n");
}

async function attachArticleImages(state, article, imagePlan, imageProviderId) {
  const plan = normalizeImagePlan(article, imagePlan);
  const images = [];
  for (const [index, image] of plan.entries()) {
    const generated = await createArticleImage(state, article, image, index, imageProviderId);
    images.push({
      ...image,
      url: generated.url,
      source: generated.source
    });
  }

  article.content = insertImagesIntoContent(article.content, images);

  article.coverUrl = images.find((image) => image.type === "cover")?.url || images[0]?.url || "";
  article.images = images;
  article.imageProvider = imageProviderId || state.settings.defaultImageProvider || "svg-fallback";
  return article;
}

function fallbackIdeas(settings, requestedTopic, count) {
  const { topic, rewritten } = normalizeTopic(requestedTopic || settings.categories.join("、"));
  const seeds = [
    ["7 个值得放进工作流的 AI 工具", "从写作、检索、代码和自动化四个场景筛选实用工具"],
    ["Mac 用户的软件选择清单", "正版优惠、开源替代和隐私风险一次讲清"],
    ["开发者如何搭一个私人知识库", "从资料收集、标签、检索到 AI 问答的完整流程"],
    ["一款工具值不值得买", "用效率收益、学习成本和数据安全做评估"],
    ["AI 编程助手对比", "用真实开发任务看代码补全、重构和测试生成能力"],
    ["软件分享前的安全检查表", "下载源、签名、权限、联网行为和替代方案"],
    ["把重复运营工作交给自动化", "选题、摘要、排版、复盘的轻量工作流"],
    ["开发工具箱月度更新", "挑选近期稳定、可持续使用的工具与插件"]
  ];
  return seeds.slice(0, count).map(([title, angle]) => ({
    id: id("idea"),
    title: topic && !title.includes(topic) ? `${title}：${topic}` : title,
    angle,
    category: settings.categories[Math.floor(Math.random() * settings.categories.length)] || "AI 工具",
    audience: settings.audience,
    compliance: rewritten ? "已把软件授权敏感选题改写为合规角度。" : "clear",
    createdAt: new Date().toISOString()
  }));
}

function fallbackArticle(settings, idea) {
  const normalized = normalizeTopic(idea.title || idea.topic || "AI 工具");
  const title = normalized.topic;
  const sections = [
    "## 为什么值得关注",
    "AI 工具和软件效率的真正价值，不在于堆功能，而在于能否稳定解决一个具体问题。选择工具时，建议先看它是否能融入现有流程，再看价格、隐私、团队协作和长期维护。",
    "## 适合谁",
    `这篇内容适合${settings.audience}。如果你正在整理自己的工具箱，可以把它当成一次筛选清单，而不是单纯的软件推荐。`,
    "## 实用判断标准",
    "- 是否来自可信来源，是否有清晰的更新记录\n- 是否支持导出数据，避免被单个平台锁住\n- 是否有合理的正版价格、教育优惠或开源替代\n- 是否过度索取权限，尤其是通讯录、屏幕录制和完整磁盘访问\n- 是否能显著减少重复劳动，而不是制造新的维护成本",
    "## 推荐运营角度",
    "可以把内容写成工具实测、场景对比、配置教程或替代方案清单。涉及软件授权时，只讨论正版购买、官方试用、开源替代和安全风险，避免非官方资源入口或授权规避路径。",
    "## 小结",
    "好工具应该让工作变得更轻，不应该让安全和版权风险变成长期负担。先从一个具体场景试用，再决定是否长期纳入工作流。"
  ];
  return {
    id: id("article"),
    title,
    digest: "从真实场景出发，筛选更值得长期使用的 AI 与软件工具。",
    content: sections.join("\n\n"),
    coverPrompt: "A clean editorial image of a Mac workspace with AI tools, code editor, productivity apps, realistic lighting, no text",
    imagePlan: [],
    category: idea.category || "软件分享",
    status: "draft",
    provider: "fallback",
    compliance: complianceReport(sections.join("\n\n")),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function generateIdeas(state, input) {
  const count = Math.min(Math.max(Number(input.count || 6), 1), 12);
  const normalized = normalizeTopic(input.topic || state.settings.categories.join("、"));
  const fallback = fallbackIdeas(state.settings, normalized.topic, count);
  const content = await callModel(
    state.settings,
    input.providerId,
    [
      {
        role: "system",
        content:
          "你是公众号内容主编。只输出 JSON 数组，不要 Markdown。禁止提供破解、盗版下载、绕过授权、注册机、激活码等内容；相关话题只能改写为正版优惠、开源替代、软件安全风险或合规采购。"
      },
      {
        role: "user",
        content: `账号定位：${state.settings.categories.join("、")}
读者：${state.settings.audience}
语气：${state.settings.tone}
主题：${normalized.topic}
生成 ${count} 个公众号选题。每项包含 title、angle、category、audience、whyNow。`
      }
    ],
    { temperature: 0.85 }
  );
  const parsed = parseModelJson(content, fallback);
  return (Array.isArray(parsed) ? parsed : fallback).slice(0, count).map((idea) => ({
    id: id("idea"),
    title: String(idea.title || "未命名选题"),
    angle: String(idea.angle || idea.whyNow || "从实用角度展开"),
    category: String(idea.category || state.settings.categories[0] || "AI 工具"),
    audience: String(idea.audience || state.settings.audience),
    compliance: normalized.rewritten ? "已改写敏感软件授权选题。" : complianceReport(`${idea.title} ${idea.angle}`).status,
    createdAt: new Date().toISOString()
  }));
}

async function generateArticle(state, input) {
  const sourceArticle = input.sourceUrl ? await fetchExternalArticle(input.sourceUrl) : null;
  const idea = {
    title: input.title || input.topic || sourceArticle?.title || "AI 工具实用指南",
    angle: input.angle || (sourceArticle ? "基于外部文章提取要点，写成原创公众号解读" : "从真实工作流出发，给出可执行建议"),
    category: input.category || state.settings.categories[0]
  };
  const normalized = normalizeTopic(idea.title);
  idea.title = normalized.topic;

  const fallback = fallbackArticle(state.settings, idea);
  const content = await callModel(
    state.settings,
    input.providerId,
    [
      {
        role: "system",
        content:
          "你是公众号作者。只输出 JSON 对象。不要提供破解下载、激活码、注册机、绕过授权、盗版资源入口或操作步骤。涉及软件授权争议时，必须转向正版优惠、官方试用、开源替代、安全风险和合规采购。若用户提供外部文章，只能提取事实和要点，写成原创解读、评论或教程，不要大段照搬原文。"
      },
      {
        role: "user",
        content: `请写一篇公众号文章草稿。
标题：${idea.title}
角度：${idea.angle}
分类：${idea.category}
读者：${state.settings.audience}
语气：${state.settings.tone}
作者：${state.settings.defaultAuthor || "未署名"}
${sourceArticle ? `
外部文章来源：${sourceArticle.url}
外部文章标题：${sourceArticle.title}
外部文章摘要：${sourceArticle.description}
外部文章正文摘录：
${sourceArticle.text}

改写要求：
- 不要逐段同义替换，不要保留原文结构。
- 提炼核心事实、观点和可执行建议，写成面向本账号读者的原创文章。
- 正文末尾用一行标注“参考来源：${sourceArticle.url}”。
- 如原文是新闻/产品信息，加入自己的分析、适用人群和风险提醒。
` : ""}

输出 JSON 字段：
title, digest, content, coverPrompt, category, imagePlan
content 使用 Markdown，结构包含：开头、3-5 个小标题、清单、结尾。
imagePlan 是数组，由你根据正文实际需要决定数量：必须包含 1 个 cover；正文 inline 图可以是 0-4 个，不要为了凑数硬加。每项字段：type(cover/inline), title, alt, prompt, afterHeading。prompt 给图片模型使用，要具体描述画面，不要出现文字、logo、水印。`
      }
    ],
    { temperature: 0.72 }
  );
  const parsed = parseModelJson(content, fallback);
  const body = String(parsed.content || fallback.content);
  const article = {
    id: id("article"),
    title: String(parsed.title || fallback.title),
    digest: String(parsed.digest || fallback.digest).slice(0, 120),
    content: body,
    coverPrompt: String(parsed.coverPrompt || fallback.coverPrompt),
    imagePlan: Array.isArray(parsed.imagePlan) ? parsed.imagePlan : fallback.imagePlan,
    category: String(parsed.category || idea.category || "AI 工具"),
    sourceUrl: sourceArticle?.url || "",
    sourceTitle: sourceArticle?.title || "",
    status: "draft",
    provider: input.providerId || state.settings.defaultProvider,
    compliance: complianceReport(`${parsed.title || ""}\n${body}`),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return attachArticleImages(state, article, article.imagePlan, input.imageProviderId);
}

function mdToHtml(markdown = "") {
  return markdown
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      const image = trimmed.match(/^!\[(.*?)]\((.*?)\)$/);
      if (image) {
        const url = safeImageUrl(image[2]);
        if (!url) return "";
        return `<figure><img src="${url}" alt="${escapeHtml(image[1])}" style="width:100%;height:auto;border-radius:8px;display:block;"/><figcaption style="color:#66736e;font-size:13px;margin-top:8px;text-align:center;">${escapeHtml(image[1])}</figcaption></figure>`;
      }
      if (trimmed.startsWith("## ")) return `<h2>${escapeHtml(trimmed.slice(3))}</h2>`;
      if (trimmed.startsWith("# ")) return `<h1>${escapeHtml(trimmed.slice(2))}</h1>`;
      if (block.startsWith("- ")) {
        const items = trimmed
          .split("\n")
          .filter((line) => line.startsWith("- "))
          .map((line) => `<li>${escapeHtml(line.slice(2))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${escapeHtml(trimmed).replaceAll("\n", "<br>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

async function getWechatToken(publishing) {
  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", publishing.wechatAppId);
  url.searchParams.set("secret", publishing.wechatAppSecret);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new Error(data.errmsg || "获取微信 access_token 失败");
  }
  return data.access_token;
}

async function uploadWechatImageMaterial(publishing, file) {
  if (!publishing.wechatAppId || !publishing.wechatAppSecret) {
    throw new Error("缺少公众号 AppID 或 AppSecret。");
  }
  if (!/^image\/(jpeg|jpg|png|gif|bmp|webp)$/i.test(file.mimeType)) {
    throw new Error("请选择图片文件。微信封面建议使用 JPG 或 PNG。");
  }

  const accessToken = await getWechatToken(publishing);
  const form = new FormData();
  form.append("media", new Blob([file.buffer], { type: file.mimeType }), file.filename || "cover.png");
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=image`,
    {
      method: "POST",
      body: form
    }
  );
  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new Error(data.errmsg || "上传微信图片素材失败");
  }
  if (!data.media_id) {
    throw new Error("微信没有返回 media_id。");
  }
  return {
    mediaId: data.media_id,
    url: data.url || ""
  };
}

async function createWechatDraft(settings, article) {
  const publishing = settings.publishing;
  if (!publishing.wechatAppId || !publishing.wechatAppSecret) {
    throw new Error("缺少公众号 AppID 或 AppSecret。");
  }
  if (!publishing.defaultThumbMediaId) {
    throw new Error("缺少微信封面素材 thumb_media_id。文章已生成本地配图，但微信公众号草稿封面必须使用素材库 media_id。");
  }

  const accessToken = await getWechatToken(publishing);
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      articles: [
        {
          title: article.title,
          author: settings.defaultAuthor || "",
          digest: article.digest,
          content: mdToHtml(article.content),
          content_source_url: publishing.contentSourceUrl || "",
          thumb_media_id: publishing.defaultThumbMediaId,
          need_open_comment: 0,
          only_fans_can_comment: 0
        }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new Error(data.errmsg || "创建微信草稿失败");
  }
  return data.media_id;
}

async function submitWechatPublish(settings, mediaId) {
  const accessToken = await getWechatToken(settings.publishing);
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ media_id: mediaId })
  });
  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new Error(data.errmsg || "提交微信发布失败");
  }
  return data.publish_id;
}

async function publishArticle(state, articleId, mode) {
  const article = state.articles.find((item) => item.id === articleId);
  if (!article) throw new Error("文章不存在。");
  const compliance = complianceReport(`${article.title}\n${article.content}`);
  article.compliance = compliance;
  article.updatedAt = new Date().toISOString();
  if (compliance.status === "blocked") {
    article.status = "blocked";
    throw new Error(compliance.message);
  }

  if (mode === "webhook") {
    const webhookUrl = state.settings.publishing.webhookUrl;
    if (!webhookUrl) throw new Error("缺少 webhook 地址。");
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ article, html: mdToHtml(article.content) })
    });
    if (!response.ok) throw new Error(`Webhook 发布失败：${response.status}`);
    article.status = "published";
    return { mode, ok: true };
  }

  if (mode === "wechat_draft" || mode === "wechat_publish") {
    const mediaId = await createWechatDraft(state.settings, article);
    article.status = mode === "wechat_publish" ? "publishing" : "draft_uploaded";
    const result = { mode, mediaId };
    if (mode === "wechat_publish") {
      result.publishId = await submitWechatPublish(state.settings, mediaId);
      article.status = "published_submitted";
    }
    return result;
  }

  article.status = "published";
  return { mode: "local", ok: true };
}

async function handleApi(req, res, pathname) {
  const state = await loadState();

  if (req.method === "GET" && pathname === "/api/state") {
    return sendJson(res, 200, publicState(state));
  }

  if (req.method === "GET" && pathname === "/api/export-config") {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return sendJsonDownload(res, `wechat-ops-config-${stamp}.json`, {
      app: "wechat-ops-console",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: state.settings
    });
  }

  if (req.method === "POST" && pathname === "/api/models") {
    const input = await readJson(req);
    try {
      const provider = providerFromInput(state, input);
      const models = await fetchProviderModels(provider);
      return sendJson(res, 200, { models });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/test-model") {
    const input = await readJson(req);
    try {
      const provider = providerFromInput(state, input);
      const response = await testProviderModel(provider);
      return sendJson(res, 200, { ok: true, response });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/test-image-model") {
    const input = await readJson(req);
    try {
      const provider = imageProviderFromInput(state, input);
      const url = await testImageProviderModel(provider);
      return sendJson(res, 200, { ok: true, url });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/image-models") {
    const input = await readJson(req);
    try {
      const provider = imageProviderFromInput(state, input);
      const models = await fetchImageProviderModels(provider);
      return sendJson(res, 200, { models });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/wechat/upload-thumb") {
    try {
      const file = await readMultipartFile(req);
      const result = await uploadWechatImageMaterial(state.settings.publishing, file);
      state.settings.publishing.defaultThumbMediaId = result.mediaId;
      await saveState(state);
      return sendJson(res, 200, {
        mediaId: result.mediaId,
        url: result.url,
        state: publicState(state)
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/settings") {
    const input = await readJson(req);
    const currentProviders = new Map(state.settings.providers.map((provider) => [provider.id, provider]));
    const providers = mergeProviders(input.providers || state.settings.providers).map((provider) => {
      const existing = currentProviders.get(provider.id) || {};
      return {
        ...existing,
        ...provider,
        apiKey: provider.apiKey === "********" ? existing.apiKey || "" : provider.apiKey || ""
      };
    });
    const currentImageProviders = new Map(state.settings.imageProviders.map((provider) => [provider.id, provider]));
    const imageProviders = mergeImageProviders(input.imageProviders || state.settings.imageProviders).map((provider) => {
      const existing = currentImageProviders.get(provider.id) || {};
      return {
        ...existing,
        ...provider,
        apiKey: provider.apiKey === "********" ? existing.apiKey || "" : provider.apiKey || ""
      };
    });
    const publishing = {
      ...state.settings.publishing,
      ...(input.publishing || {})
    };
    if (publishing.wechatAppSecret === "********") {
      publishing.wechatAppSecret = state.settings.publishing.wechatAppSecret || "";
    }
    const defaultProvider = providers.some((provider) => provider.id === input.defaultProvider)
      ? input.defaultProvider
      : providers[0]?.id || "";
    const defaultImageProvider = imageProviders.some((provider) => provider.id === input.defaultImageProvider)
      ? input.defaultImageProvider
      : imageProviders[0]?.id || "";
    state.settings = {
      ...state.settings,
      ...input,
      defaultProvider,
      defaultImageProvider,
      providers,
      imageProviders,
      publishing
    };
    await saveState(state);
    return sendJson(res, 200, publicState(state));
  }

  if (req.method === "POST" && pathname === "/api/generate/ideas") {
    const input = await readJson(req);
    const ideas = await generateIdeas(state, input);
    state.ideas.unshift(...ideas);
    await saveState(state);
    return sendJson(res, 200, { ideas, state: publicState(state) });
  }

  if (req.method === "POST" && pathname === "/api/generate/article") {
    const input = await readJson(req);
    const article = await generateArticle(state, input);
    state.articles.unshift(article);
    await saveState(state);
    return sendJson(res, 200, { article, state: publicState(state) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/ideas/")) {
    const ideaId = pathname.split("/").at(-1);
    const before = state.ideas.length;
    state.ideas = state.ideas.filter((item) => item.id !== ideaId);
    if (state.ideas.length === before) return sendJson(res, 404, { error: "选题不存在。" });
    await saveState(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/articles/")) {
    const articleId = pathname.split("/").at(-1);
    const before = state.articles.length;
    state.articles = state.articles.filter((item) => item.id !== articleId);
    if (state.articles.length === before) return sendJson(res, 404, { error: "文章不存在。" });
    state.jobs = state.jobs.filter((job) => job.articleId !== articleId);
    await saveState(state);
    return sendJson(res, 200, { state: publicState(state) });
  }

  if (req.method === "PATCH" && pathname.startsWith("/api/articles/")) {
    const input = await readJson(req);
    const articleId = pathname.split("/").at(-1);
    const article = state.articles.find((item) => item.id === articleId);
    if (!article) return sendJson(res, 404, { error: "文章不存在。" });
    Object.assign(article, {
      ...input,
      compliance: complianceReport(`${input.title || article.title}\n${input.content || article.content}`),
      updatedAt: new Date().toISOString()
    });
    await saveState(state);
    return sendJson(res, 200, { article, state: publicState(state) });
  }

  if (req.method === "POST" && pathname === "/api/schedule") {
    const input = await readJson(req);
    const job = {
      id: id("job"),
      articleId: input.articleId,
      mode: input.mode || "local",
      publishAt: input.publishAt,
      status: "scheduled",
      createdAt: new Date().toISOString(),
      lastError: ""
    };
    state.jobs.unshift(job);
    await saveState(state);
    return sendJson(res, 200, { job, state: publicState(state) });
  }

  if (req.method === "POST" && pathname === "/api/publish") {
    const input = await readJson(req);
    try {
      const result = await publishArticle(state, input.articleId, input.mode || "local");
      await saveState(state);
      return sendJson(res, 200, { result, state: publicState(state) });
    } catch (error) {
      await saveState(state);
      return sendJson(res, 400, { error: error.message, state: publicState(state) });
    }
  }

  return sendJson(res, 404, { error: "接口不存在。" });
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function processDueJobs() {
  const state = await loadState();
  if (!state.settings.publishing.autoPublishEnabled) return;
  const now = Date.now();
  let changed = false;
  for (const job of state.jobs) {
    if (job.status !== "scheduled") continue;
    if (!job.publishAt || new Date(job.publishAt).getTime() > now) continue;
    try {
      job.status = "running";
      changed = true;
      await publishArticle(state, job.articleId, job.mode);
      job.status = "done";
      job.completedAt = new Date().toISOString();
    } catch (error) {
      job.status = "failed";
      job.lastError = error.message;
    }
  }
  if (changed) await saveState(state);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

await ensureStore();
setInterval(() => processDueJobs().catch(() => {}), 60_000);
server.listen(PORT, HOST, () => {
  console.log(`运营后台已启动：http://${HOST}:${PORT}`);
});
