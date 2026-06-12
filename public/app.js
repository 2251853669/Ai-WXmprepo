let state = null;
let activeArticleId = null;
let taskSeq = 0;
const tasks = [];

const views = {
  dashboard: ["总览", "选题、成文、排期和发布状态集中处理。"],
  ideas: ["选题", "围绕账号定位生成可执行的内容题库。"],
  articles: ["文章", "生成、编辑和检查公众号草稿。"],
  schedule: ["发布", "把草稿加入发布队列，或立即执行发布动作。"],
  settings: ["设置", "配置模型、账号定位和发布通道。"]
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function createTask(title, detail = "") {
  const task = {
    id: `task_${++taskSeq}`,
    title,
    detail,
    status: "running",
    message: "运行中",
    startedAt: Date.now(),
    finishedAt: null
  };
  tasks.unshift(task);
  renderTasks();
  return task;
}

function updateTask(task, patch) {
  Object.assign(task, patch);
  renderTasks();
}

function finishTask(task, message = "已完成") {
  updateTask(task, {
    status: "success",
    message,
    finishedAt: Date.now()
  });
}

function failTask(task, error) {
  updateTask(task, {
    status: "error",
    message: error?.message || String(error || "任务失败"),
    finishedAt: Date.now()
  });
}

async function withTask(title, detail, work) {
  const task = createTask(title, detail);
  showAlert(`${title}进行中，任务列表会持续显示进度。`, "info", { sticky: true });
  try {
    const result = await work(task);
    finishTask(task, "已完成");
    showAlert(`${title}完成。`);
    return result;
  } catch (error) {
    failTask(task, error);
    showAlert(`${title}失败：${error.message}`, "error", { sticky: true });
    throw error;
  }
}

function renderTasks() {
  const taskList = $("#taskList");
  if (!taskList) return;
  taskList.innerHTML = tasks.length
    ? tasks
        .slice(0, 12)
        .map((task) => {
          const elapsed = formatDuration((task.finishedAt || Date.now()) - task.startedAt);
          return `
            <article class="task-item ${task.status}">
              <span class="task-dot"></span>
              <div>
                <strong>${escapeHtml(task.title)}</strong>
                <p>${escapeHtml(task.detail || task.message)}</p>
                <small>${escapeHtml(task.message)} · ${elapsed}</small>
              </div>
            </article>
          `;
        })
        .join("")
    : emptyText("还没有任务。生成文章、拉取模型、测试模型时会显示在这里。");
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}分${String(rest).padStart(2, "0")}秒` : `${rest}秒`;
}

async function downloadConfig() {
  const response = await fetch("/api/export-config");
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "导出配置失败");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `wechat-ops-config-${Date.now()}.json`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function uploadWechatThumbFile(file) {
  const form = new FormData();
  form.append("media", file);
  const response = await fetch("/api/wechat/upload-thumb", {
    method: "POST",
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "上传封面失败");
  return data;
}

function showAlert(message, type = "info", options = {}) {
  const alert = $("#alert");
  alert.textContent = message;
  alert.hidden = false;
  alert.dataset.type = type;
  window.clearTimeout(showAlert.timer);
  if (!options.sticky) {
    showAlert.timer = window.setTimeout(() => {
      alert.hidden = true;
    }, options.duration || 5200);
  }
}

async function load() {
  state = await api("/api/state");
  renderAll();
  renderTasks();
}

function renderAll() {
  renderShell();
  renderDashboard();
  renderIdeas();
  renderArticles();
  renderSchedule();
  renderSettings();
}

function renderShell() {
  $("#workspaceName").textContent = state.settings.workspaceName;
  const providerSelect = $("#providerSelect");
  providerSelect.innerHTML = state.settings.providers.length
    ? state.settings.providers
        .map((provider) => `<option value="${provider.id}">${provider.name} · ${provider.model || "未选模型"}</option>`)
        .join("")
    : `<option value="">未配置模型 · 使用本地模板</option>`;
  providerSelect.value = state.settings.defaultProvider;

  const imageProviderSelect = $("#imageProviderSelect");
  imageProviderSelect.innerHTML = state.settings.imageProviders.length
    ? state.settings.imageProviders
        .map((provider) => `<option value="${provider.id}">${provider.name} · ${provider.model || "未选模型"}</option>`)
        .join("")
    : `<option value="">未配置图片模型 · 使用本地配图</option>`;
  imageProviderSelect.value = state.settings.defaultImageProvider;
}

function renderDashboard() {
  $("#metricIdeas").textContent = state.ideas.length;
  $("#metricDrafts").textContent = state.articles.filter((article) => article.status === "draft").length;
  $("#metricJobs").textContent = state.jobs.filter((job) => job.status === "scheduled").length;
  $("#metricPublished").textContent = state.articles.filter((article) => article.status.includes("publish")).length;
  $("#latestArticles").innerHTML = state.articles.slice(0, 5).map(articleRow).join("") || emptyText("还没有文章。");
}

function renderIdeas() {
  $("#ideaList").innerHTML =
    state.ideas
      .map(
        (idea) => `
          <article class="idea-card">
            <h3>${escapeHtml(idea.title)}</h3>
            <p>${escapeHtml(idea.angle)}</p>
            <span class="badge">${escapeHtml(idea.category)}</span>
            <footer>
              <small>${formatDate(idea.createdAt)}</small>
              <button class="small danger" data-delete-idea="${idea.id}">删除</button>
              <button data-generate-from-idea="${idea.id}">成文</button>
            </footer>
          </article>
        `
      )
      .join("") || emptyText("还没有选题。");
}

function renderArticles() {
  $("#articleList").innerHTML = state.articles.map(articleRow).join("") || emptyText("还没有文章。");
  $("#scheduleArticle").innerHTML = state.articles
    .map((article) => `<option value="${article.id}">${escapeHtml(article.title)}</option>`)
    .join("");
  if (!activeArticleId && state.articles[0]) activeArticleId = state.articles[0].id;
  fillEditor();
}

function renderSchedule() {
  $("#jobList").innerHTML =
    state.jobs
      .map((job) => {
        const article = state.articles.find((item) => item.id === job.articleId);
        return `
          <article class="job-card">
            <h3>${escapeHtml(article?.title || "文章已删除")}</h3>
            <p>${escapeHtml(job.mode)} · ${formatDate(job.publishAt)}</p>
            <span class="badge ${job.status === "failed" ? "blocked" : ""}">${escapeHtml(job.status)}</span>
            ${job.lastError ? `<p>${escapeHtml(job.lastError)}</p>` : ""}
            <footer>
              <button type="button" class="small danger" data-delete-job="${job.id}">删除</button>
            </footer>
          </article>
        `;
      })
      .join("") || emptyText("还没有排期。");
}

function renderSettings() {
  $("#settingWorkspace").value = state.settings.workspaceName || "";
  $("#settingAuthor").value = state.settings.defaultAuthor || "";
  $("#settingAudience").value = state.settings.audience || "";
  $("#settingTone").value = state.settings.tone || "";
  $("#settingCategories").value = state.settings.categories.join("，");
  $("#webhookUrl").value = state.settings.publishing.webhookUrl || "";
  $("#wechatAppId").value = state.settings.publishing.wechatAppId || "";
  $("#wechatAppSecret").value = state.settings.publishing.wechatAppSecret || "";
  $("#thumbMediaId").value = state.settings.publishing.defaultThumbMediaId || "";
  $("#contentSourceUrl").value = state.settings.publishing.contentSourceUrl || "";
  $("#autoPublishEnabled").checked = Boolean(state.settings.publishing.autoPublishEnabled);
  $("#providerTemplateSelect").innerHTML = state.providerTemplates
    .map((template) => `<option value="${template.key}">${escapeHtml(template.name)}</option>`)
    .join("");
  $("#imageProviderTemplateSelect").innerHTML = state.imageProviderTemplates
    .map((template) => `<option value="${template.key}">${escapeHtml(template.name)}</option>`)
    .join("");
  $("#providerSettings").innerHTML = state.settings.providers
    .map(
      (provider) => {
        const modelOptions = (provider.models || [])
          .map((model) => `<option value="${escapeAttr(model.id)}">${escapeHtml(model.name || model.id)}</option>`)
          .join("");
        return `
        <section class="provider-box" data-provider-box="${provider.id}">
          <div class="provider-head">
            <h3>${escapeHtml(provider.name)}</h3>
            <button type="button" class="small danger" data-remove-provider="${provider.id}">删除</button>
          </div>
          <input data-provider-field="name" value="${escapeAttr(provider.name)}" placeholder="名称" />
          <select data-provider-field="type">
            <option value="openai-compatible" ${provider.type === "openai-compatible" ? "selected" : ""}>OpenAI-compatible</option>
            <option value="gemini" ${provider.type === "gemini" ? "selected" : ""}>Gemini</option>
            <option value="anthropic" ${provider.type === "anthropic" ? "selected" : ""}>Claude</option>
          </select>
          <input data-provider-field="baseUrl" value="${escapeAttr(provider.baseUrl)}" placeholder="Base URL" />
          <input data-provider-field="model" value="${escapeAttr(provider.model)}" placeholder="模型名" list="models-${provider.id}" />
          <datalist id="models-${provider.id}">${modelOptions}</datalist>
          <input data-provider-field="apiKey" value="${escapeAttr(provider.apiKey)}" placeholder="API Key" type="password" />
          <div class="provider-actions">
            <button type="button" class="small secondary" data-fetch-models="${provider.id}">拉取模型</button>
            <button type="button" class="small secondary" data-test-provider="${provider.id}">测试模型</button>
          </div>
        </section>
      `;
      }
    )
    .join("") || emptyText("还没有模型配置。");
  $("#imageProviderSettings").innerHTML = state.settings.imageProviders
    .map(
      (provider) => {
        const modelOptions = (provider.models || [])
          .map((model) => `<option value="${escapeAttr(model.id)}">${escapeHtml(model.name || model.id)}</option>`)
          .join("");
        return `
        <section class="provider-box" data-image-provider-box="${provider.id}">
          <div class="provider-head">
            <h3>${escapeHtml(provider.name)}</h3>
            <button type="button" class="small danger" data-remove-image-provider="${provider.id}">删除</button>
          </div>
          <input data-image-provider-field="name" value="${escapeAttr(provider.name)}" placeholder="名称" />
          <input data-image-provider-field="baseUrl" value="${escapeAttr(provider.baseUrl)}" placeholder="Base URL" />
          <input data-image-provider-field="model" value="${escapeAttr(provider.model)}" placeholder="图片模型名" list="image-models-${provider.id}" />
          <datalist id="image-models-${provider.id}">${modelOptions}</datalist>
          <input data-image-provider-field="size" value="${escapeAttr(provider.size || "1024x1024")}" placeholder="尺寸，例如 1024x1024" />
          <input data-image-provider-field="apiKey" value="${escapeAttr(provider.apiKey)}" placeholder="API Key" type="password" />
          <div class="provider-actions">
            <button type="button" class="small secondary" data-fetch-image-models="${provider.id}">拉取图片模型</button>
            <button type="button" class="small secondary" data-test-image-provider="${provider.id}">测试图片模型</button>
          </div>
        </section>
      `;
      }
    )
    .join("") || emptyText("还没有图片模型配置。未配置时会使用本地 SVG 配图。");
}

function articleRow(article) {
  return `
    <article class="article-row ${article.id === activeArticleId ? "is-active" : ""}" data-article-id="${article.id}">
      <strong>${escapeHtml(article.title)}</strong>
      <span>${escapeHtml(article.category)} · ${escapeHtml(article.status)} · ${formatDate(article.updatedAt || article.createdAt)}${article.sourceUrl ? " · 外链改写" : ""}</span>
      <footer>
        <button type="button" class="small danger" data-delete-article="${article.id}">删除</button>
      </footer>
    </article>
  `;
}

function fillEditor() {
  const article = state.articles.find((item) => item.id === activeArticleId);
  $("#imagePreview").innerHTML = article?.images?.length
    ? article.images
        .map((image) => `
          <figure>
            <img src="${escapeAttr(image.url)}" alt="${escapeAttr(image.alt)}" />
            <figcaption>${escapeHtml(image.type === "cover" ? "封面图" : "正文配图")}</figcaption>
          </figure>
        `)
        .join("")
    : emptyText("生成文章后会自动创建封面图和正文配图。");
  $("#editTitle").value = article?.title || "";
  $("#editDigest").value = article?.digest || "";
  $("#editContent").value = article?.content || "";
}

function setView(viewName) {
  $$(".nav-button").forEach((button) => button.classList.toggle("is-active", button.dataset.view === viewName));
  $$(".view").forEach((view) => view.classList.toggle("is-active", view.id === viewName));
  $("#viewTitle").textContent = views[viewName][0];
  $("#viewSubtitle").textContent = views[viewName][1];
}

async function generateIdeas(topic, count = 6) {
  const data = await withTask("生成选题", `主题：${topic || "默认定位"}，数量：${count}`, async (task) => {
    updateTask(task, { message: "等待文章模型返回选题" });
    return api("/api/generate/ideas", {
      method: "POST",
      body: { topic, count, providerId: $("#providerSelect").value }
    });
  });
  state = data.state;
  renderAll();
  showAlert(`已生成 ${data.ideas.length} 个选题。`);
}

async function generateArticle(input) {
  const isRewrite = Boolean(input.sourceUrl);
  const data = await withTask(isRewrite ? "外链改写文章" : "生成文章", `${input.sourceUrl ? `链接：${input.sourceUrl}` : `标题：${input.title || input.topic || "未命名"}`}；含动态配图`, async (task) => {
    updateTask(task, { message: isRewrite ? "抓取外部文章并等待模型原创改写" : "等待文章模型写稿并规划配图" });
    return api("/api/generate/article", {
      method: "POST",
      body: { ...input, providerId: $("#providerSelect").value, imageProviderId: $("#imageProviderSelect").value }
    });
  });
  state = data.state;
  activeArticleId = data.article.id;
  renderAll();
  showAlert(`文章草稿已生成，图片 ${data.article.images?.length || 0} 张。`);
}

function collectSettings() {
  const providerBoxes = $$("[data-provider-box]");
  const providers = providerBoxes.map((box) => {
    const existing = state.settings.providers.find((provider) => provider.id === box.dataset.providerBox);
    return {
      ...existing,
      name: box.querySelector('[data-provider-field="name"]').value.trim(),
      type: box.querySelector('[data-provider-field="type"]').value,
      baseUrl: box.querySelector('[data-provider-field="baseUrl"]').value.trim(),
      model: box.querySelector('[data-provider-field="model"]').value.trim(),
      apiKey: box.querySelector('[data-provider-field="apiKey"]').value.trim(),
      templateKey: existing?.templateKey || "custom-compatible",
      models: existing?.models || []
    };
  });
  const imageProviderBoxes = $$("[data-image-provider-box]");
  const imageProviders = imageProviderBoxes.map((box) => {
    const existing = state.settings.imageProviders.find((provider) => provider.id === box.dataset.imageProviderBox);
    return {
      ...existing,
      name: box.querySelector('[data-image-provider-field="name"]').value.trim(),
      type: "openai-image-compatible",
      baseUrl: box.querySelector('[data-image-provider-field="baseUrl"]').value.trim(),
      model: box.querySelector('[data-image-provider-field="model"]').value.trim(),
      size: box.querySelector('[data-image-provider-field="size"]').value.trim() || "1024x1024",
      apiKey: box.querySelector('[data-image-provider-field="apiKey"]').value.trim(),
      templateKey: existing?.templateKey || "custom-image-compatible",
      models: existing?.models || []
    };
  });
  return {
    workspaceName: $("#settingWorkspace").value.trim() || "AI 工具运营台",
    defaultProvider: $("#providerSelect").value,
    defaultAuthor: $("#settingAuthor").value.trim(),
    audience: $("#settingAudience").value.trim(),
    tone: $("#settingTone").value.trim(),
    categories: $("#settingCategories").value.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
    defaultImageProvider: $("#imageProviderSelect").value,
    providers,
    imageProviders,
    publishing: {
      webhookUrl: $("#webhookUrl").value.trim(),
      wechatAppId: $("#wechatAppId").value.trim(),
      wechatAppSecret: $("#wechatAppSecret").value.trim(),
      defaultThumbMediaId: $("#thumbMediaId").value.trim(),
      contentSourceUrl: $("#contentSourceUrl").value.trim(),
      autoPublishEnabled: $("#autoPublishEnabled").checked
    }
  };
}

function emptyText(text) {
  return `<p class="muted">${escapeHtml(text)}</p>`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

function formatDate(value) {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) setView(nav.dataset.view);

  const ideaButton = event.target.closest("[data-generate-from-idea]");
  if (ideaButton) {
    event.stopPropagation();
    const idea = state.ideas.find((item) => item.id === ideaButton.dataset.generateFromIdea);
    await generateArticle({ title: idea.title, angle: idea.angle, category: idea.category });
    setView("articles");
  }

  const deleteIdeaButton = event.target.closest("[data-delete-idea]");
  if (deleteIdeaButton) {
    event.stopPropagation();
    await deleteIdea(deleteIdeaButton.dataset.deleteIdea);
    return;
  }

  const deleteArticleButton = event.target.closest("[data-delete-article]");
  if (deleteArticleButton) {
    event.stopPropagation();
    await deleteArticle(deleteArticleButton.dataset.deleteArticle);
    return;
  }

  const deleteJobButton = event.target.closest("[data-delete-job]");
  if (deleteJobButton) {
    event.stopPropagation();
    await deleteJob(deleteJobButton.dataset.deleteJob);
    return;
  }

  const articleRowElement = event.target.closest("[data-article-id]");
  if (articleRowElement) {
    activeArticleId = articleRowElement.dataset.articleId;
    renderArticles();
  }

  const removeProviderButton = event.target.closest("[data-remove-provider]");
  if (removeProviderButton) {
    const providerId = removeProviderButton.dataset.removeProvider;
    state.settings.providers = state.settings.providers.filter((provider) => provider.id !== providerId);
    if (state.settings.defaultProvider === providerId) {
      state.settings.defaultProvider = state.settings.providers[0]?.id || "";
    }
    renderAll();
  }

  const removeImageProviderButton = event.target.closest("[data-remove-image-provider]");
  if (removeImageProviderButton) {
    const providerId = removeImageProviderButton.dataset.removeImageProvider;
    state.settings.imageProviders = state.settings.imageProviders.filter((provider) => provider.id !== providerId);
    if (state.settings.defaultImageProvider === providerId) {
      state.settings.defaultImageProvider = state.settings.imageProviders[0]?.id || "";
    }
    renderAll();
  }

  const fetchModelsButton = event.target.closest("[data-fetch-models]");
  if (fetchModelsButton) {
    await fetchModelsForProvider(fetchModelsButton.dataset.fetchModels);
  }

  const testProviderButton = event.target.closest("[data-test-provider]");
  if (testProviderButton) {
    await testProvider(testProviderButton.dataset.testProvider);
  }

  const testImageProviderButton = event.target.closest("[data-test-image-provider]");
  if (testImageProviderButton) {
    await testImageProvider(testImageProviderButton.dataset.testImageProvider);
  }

  const fetchImageModelsButton = event.target.closest("[data-fetch-image-models]");
  if (fetchImageModelsButton) {
    await fetchImageModelsForProvider(fetchImageModelsButton.dataset.fetchImageModels);
  }
});

async function deleteIdea(ideaId) {
  const idea = state.ideas.find((item) => item.id === ideaId);
  if (!idea) return;
  if (!window.confirm(`删除选题「${idea.title}」？`)) return;
  const data = await api(`/api/ideas/${ideaId}`, { method: "DELETE" });
  state = data.state;
  renderAll();
  showAlert("选题已删除。");
}

async function deleteArticle(articleId) {
  const article = state.articles.find((item) => item.id === articleId);
  if (!article) return;
  if (!window.confirm(`删除文章「${article.title}」？相关排期也会删除。`)) return;
  const data = await api(`/api/articles/${articleId}`, { method: "DELETE" });
  state = data.state;
  if (activeArticleId === articleId) activeArticleId = state.articles[0]?.id || null;
  renderAll();
  showAlert("文章已删除。");
}

async function deleteJob(jobId) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  const article = state.articles.find((item) => item.id === job.articleId);
  const title = article?.title || "文章已删除";
  if (!window.confirm(`删除发布任务「${title}」？`)) return;
  try {
    const data = await withTask("删除发布任务", title, async (task) => {
      updateTask(task, { message: "正在从发布队列移除" });
      return api(`/api/jobs/${jobId}`, { method: "DELETE" });
    });
    state = data.state;
    renderAll();
    showAlert("发布任务已删除。");
  } catch (error) {
    const message =
      error.message === "接口不存在。"
        ? "删除接口不存在：当前后端还是旧进程，请重启 npm start 后再试。"
        : error.message;
    showAlert(message, "error", { sticky: true });
  }
}

function providerFromBox(providerId) {
  const box = document.querySelector(`[data-provider-box="${providerId}"]`);
  const existing = state.settings.providers.find((provider) => provider.id === providerId);
  return {
    ...existing,
    name: box.querySelector('[data-provider-field="name"]').value.trim(),
    type: box.querySelector('[data-provider-field="type"]').value,
    baseUrl: box.querySelector('[data-provider-field="baseUrl"]').value.trim(),
    model: box.querySelector('[data-provider-field="model"]').value.trim(),
    apiKey: box.querySelector('[data-provider-field="apiKey"]').value.trim()
  };
}

function imageProviderFromBox(providerId) {
  const box = document.querySelector(`[data-image-provider-box="${providerId}"]`);
  const existing = state.settings.imageProviders.find((provider) => provider.id === providerId);
  return {
    ...existing,
    name: box.querySelector('[data-image-provider-field="name"]').value.trim(),
    type: "openai-image-compatible",
    baseUrl: box.querySelector('[data-image-provider-field="baseUrl"]').value.trim(),
    model: box.querySelector('[data-image-provider-field="model"]').value.trim(),
    size: box.querySelector('[data-image-provider-field="size"]').value.trim() || "1024x1024",
    apiKey: box.querySelector('[data-image-provider-field="apiKey"]').value.trim(),
    models: existing?.models || []
  };
}

async function fetchModelsForProvider(providerId) {
  try {
    const provider = providerFromBox(providerId);
    const data = await withTask("拉取文字模型", provider.name || provider.baseUrl, async (task) => {
      updateTask(task, { message: "请求模型列表接口" });
      return api("/api/models", {
        method: "POST",
        body: { provider }
      });
    });
    const target = state.settings.providers.find((item) => item.id === providerId);
    Object.assign(target, provider, { models: data.models });
    if (!target.model && data.models[0]) target.model = data.models[0].id;
    renderAll();
    showAlert(`已拉取 ${data.models.length} 个模型。`);
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function testProvider(providerId) {
  try {
    const provider = providerFromBox(providerId);
    const data = await withTask("测试文字模型", `${provider.name || "模型"} · ${provider.model || "未选模型"}`, async (task) => {
      updateTask(task, { message: "发送短测试请求" });
      return api("/api/test-model", {
        method: "POST",
        body: { provider }
      });
    });
    const reply = data.response ? `模型回复：${data.response}` : "模型已连通。";
    showAlert(reply);
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function testImageProvider(providerId) {
  try {
    const provider = imageProviderFromBox(providerId);
    const data = await withTask("测试图片模型", `${provider.name || "图片模型"} · ${provider.model || "未选模型"}`, async (task) => {
      updateTask(task, { message: "发送图片生成测试请求" });
      return api("/api/test-image-model", {
        method: "POST",
        body: { provider }
      });
    });
    showAlert(data.url ? `图片模型已连通：${data.url}` : "图片模型已连通。");
  } catch (error) {
    showAlert(error.message, "error");
  }
}

async function fetchImageModelsForProvider(providerId) {
  try {
    const provider = imageProviderFromBox(providerId);
    const data = await withTask("拉取图片模型", provider.name || provider.baseUrl, async (task) => {
      updateTask(task, { message: "请求图片模型列表接口" });
      return api("/api/image-models", {
        method: "POST",
        body: { provider }
      });
    });
    const target = state.settings.imageProviders.find((item) => item.id === providerId);
    Object.assign(target, provider, { models: data.models });
    if (!target.model && data.models[0]) target.model = data.models[0].id;
    renderAll();
    showAlert(`已拉取 ${data.models.length} 个图片模型。`);
  } catch (error) {
    showAlert(error.message, "error");
  }
}

$("#addProvider").addEventListener("click", () => {
  const template = state.providerTemplates.find((item) => item.key === $("#providerTemplateSelect").value);
  if (!template) return;
  const sameTemplateCount = state.settings.providers.filter((provider) => provider.templateKey === template.key).length + 1;
  const provider = {
    id: `${template.key}_${Date.now().toString(36)}`,
    name: sameTemplateCount > 1 ? `${template.name} ${sameTemplateCount}` : template.name,
    type: template.type,
    baseUrl: template.baseUrl,
    model: template.model,
    apiKey: "",
    templateKey: template.key,
    models: []
  };
  state.settings.providers.push(provider);
  state.settings.defaultProvider = provider.id;
  renderAll();
  showAlert("已新增模型配置，填入 API Key 后可以拉取模型或测试。");
});

$("#addImageProvider").addEventListener("click", () => {
  const template = state.imageProviderTemplates.find((item) => item.key === $("#imageProviderTemplateSelect").value);
  if (!template) return;
  const sameTemplateCount = state.settings.imageProviders.filter((provider) => provider.templateKey === template.key).length + 1;
  const provider = {
    id: `${template.key}_${Date.now().toString(36)}`,
    name: sameTemplateCount > 1 ? `${template.name} ${sameTemplateCount}` : template.name,
    type: template.type,
    baseUrl: template.baseUrl,
    model: template.model,
    size: template.size || "1024x1024",
    apiKey: "",
    templateKey: template.key,
    models: []
  };
  state.settings.imageProviders.push(provider);
  state.settings.defaultImageProvider = provider.id;
  renderAll();
  showAlert("已新增图片模型配置，填入 API Key 后可以拉取图片模型或手动填写。");
});

$("#quickGenerate").addEventListener("click", () => generateIdeas($("#quickTopic").value, 6));

$("#ideaForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await generateIdeas($("#ideaTopic").value, $("#ideaCount").value);
});

$("#articleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await generateArticle({
    title: $("#articleTitle").value,
    angle: $("#articleAngle").value,
    category: $("#articleCategory").value,
    sourceUrl: $("#articleSourceUrl").value.trim()
  });
});

$("#saveArticle").addEventListener("click", async () => {
  if (!activeArticleId) return;
  const data = await api(`/api/articles/${activeArticleId}`, {
    method: "PATCH",
    body: {
      title: $("#editTitle").value,
      digest: $("#editDigest").value,
      content: $("#editContent").value
    }
  });
  state = data.state;
  renderAll();
  showAlert("文章已保存。");
});

$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = await api("/api/settings", {
    method: "POST",
    body: collectSettings()
  });
  state = data;
  renderAll();
  showAlert("设置已保存。");
});

$("#exportConfig").addEventListener("click", async () => {
  try {
    await withTask("导出配置", "下载当前配置文件", async (task) => {
      updateTask(task, { message: "准备配置文件" });
      await downloadConfig();
      return true;
    });
    showAlert("配置已导出。导出文件包含 API Key，请妥善保存。");
  } catch (error) {
    showAlert(error.message, "error");
  }
});

$("#uploadWechatThumb").addEventListener("click", async () => {
  const file = $("#wechatThumbFile").files?.[0];
  if (!file) {
    showAlert("请先选择一张封面图片。", "error");
    return;
  }
  try {
    const data = await withTask("上传微信封面", file.name, async (task) => {
      updateTask(task, { message: "上传到微信公众号素材库" });
      return uploadWechatThumbFile(file);
    });
    state = data.state;
    renderAll();
    $("#thumbMediaId").value = data.mediaId;
    showAlert("封面已上传，素材 media_id 已自动填入。");
  } catch (error) {
    showAlert(error.message, "error", { sticky: true });
  }
});

$("#clearFinishedTasks").addEventListener("click", () => {
  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    if (tasks[index].status !== "running") tasks.splice(index, 1);
  }
  renderTasks();
});

window.setInterval(() => {
  if (tasks.some((task) => task.status === "running")) renderTasks();
}, 1000);

$("#providerSelect").addEventListener("change", async () => {
  const data = await api("/api/settings", {
    method: "POST",
    body: { ...collectSettings(), defaultProvider: $("#providerSelect").value }
  });
  state = data;
  renderAll();
});

$("#imageProviderSelect").addEventListener("change", async () => {
  const data = await api("/api/settings", {
    method: "POST",
    body: { ...collectSettings(), defaultImageProvider: $("#imageProviderSelect").value }
  });
  state = data;
  renderAll();
});

$("#scheduleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = await withTask("加入排期", "保存发布计划", async (task) => {
    updateTask(task, { message: "写入发布队列" });
    return api("/api/schedule", {
      method: "POST",
      body: {
        articleId: $("#scheduleArticle").value,
        publishAt: $("#scheduleTime").value,
        mode: $("#publishMode").value
      }
    });
  });
  state = data.state;
  renderAll();
  showAlert("已加入发布队列。");
});

$("#publishNow").addEventListener("click", async () => {
  const articleId = $("#scheduleArticle").value;
  if (!articleId) return;
  try {
    const data = await withTask("执行发布", `方式：${$("#publishMode").value}`, async (task) => {
      updateTask(task, { message: "提交发布动作" });
      return api("/api/publish", {
        method: "POST",
        body: { articleId, mode: $("#publishMode").value }
      });
    });
    state = data.state;
    renderAll();
    showAlert("发布动作已执行。");
  } catch (error) {
    await load();
    showAlert(error.message, "error");
  }
});

load().catch((error) => showAlert(error.message, "error"));
