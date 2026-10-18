const API_BASE_URL = window.location.origin;
const TOKEN_STORAGE_KEY = "ifms_access_token";
const accessToken = localStorage.getItem(TOKEN_STORAGE_KEY);
const resourceId = Number(new URLSearchParams(window.location.search).get("id"));

let currentResource = null;
let resourcePages = [];
let previewObjectUrl = null;

const elements = {
    title: document.getElementById("viewerPageTitle"),
    category: document.getElementById("viewerCategory"),
    fileMeta: document.getElementById("viewerFileMeta"),
    type: document.getElementById("viewerType"),
    date: document.getElementById("viewerDate"),
    size: document.getElementById("viewerSize"),
    loading: document.getElementById("viewerLoading"),
    error: document.getElementById("viewerError"),
    errorMessage: document.getElementById("viewerErrorMessage"),
    frame: document.getElementById("documentFrame"),
    image: document.getElementById("imageViewer"),
    video: document.getElementById("videoViewer"),
    text: document.getElementById("textViewer"),
    topics: document.getElementById("viewerTopics"),
    topicNotice: document.getElementById("topicNotice"),
    rename: document.getElementById("renameButton"),
    download: document.getElementById("downloadButton"),
    original: document.getElementById("openOriginalButton"),
};

function authHeaders(extra = {}) {
    return accessToken ? { ...extra, Authorization: "Bearer " + accessToken } : extra;
}

function formatApiError(data, fallback = "Something went wrong. Please try again.") {
    if (Array.isArray(data?.detail)) return data.detail.map((item) => item.msg).join(" ");
    return data?.detail || fallback;
}

function formatSize(bytes) {
    if (bytes === null || bytes === undefined) return "Not available";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setTopicNotice(message, type = "") {
    elements.topicNotice.textContent = message;
    elements.topicNotice.className = "notice " + type;
}

function showError(message) {
    elements.loading.hidden = true;
    elements.errorMessage.textContent = message;
    elements.error.hidden = false;
}

function renderMetadata() {
    const resource = currentResource;
    document.title = `${resource.name} | Intelligent Digital Library`;
    elements.title.textContent = resource.name;
    elements.category.textContent = resource.category;
    elements.fileMeta.textContent = resource.external_url ? "Saved webpage" : formatSize(resource.size_bytes);
    elements.type.textContent = resource.resource_type.replaceAll("_", " ");
    elements.date.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(
        new Date(resource.created_at),
    );
    elements.size.textContent = resource.external_url ? "Web resource" : formatSize(resource.size_bytes);
    elements.rename.hidden = false;
    elements.download.hidden = Boolean(resource.external_url);
    if (resource.external_url) {
        elements.original.href = resource.external_url;
        elements.original.hidden = false;
    }
}

function topicChip(topic) {
    const chip = document.createElement("span");
    chip.className = "topic-chip";

    const jump = document.createElement("button");
    jump.type = "button";
    jump.className = "topic-jump";
    jump.dataset.page = topic.pages?.[0] || "";
    jump.title = `${Math.round(topic.confidence * 100)}% confidence`;
    jump.textContent = topic.name + (topic.pages?.length ? ` · p. ${topic.pages.join(", ")}` : "");

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "topic-remove";
    remove.dataset.id = topic.id;
    remove.setAttribute("aria-label", `Remove ${topic.name}`);
    remove.textContent = "×";

    chip.append(jump, remove);
    return chip;
}

function renderTopics() {
    elements.topics.replaceChildren();
    if (!currentResource.topics.length) {
        const empty = document.createElement("span");
        empty.className = "topic-empty";
        empty.textContent = "No topics detected. Add one below.";
        elements.topics.append(empty);
        return;
    }
    currentResource.topics.forEach((topic) => elements.topics.append(topicChip(topic)));
}

function renderTextPages() {
    elements.text.replaceChildren();
    if (!resourcePages.length) {
        const empty = document.createElement("div");
        empty.className = "text-page text-page-empty";
        const heading = document.createElement("h2");
        heading.textContent = "No text preview is available";
        const message = document.createElement("p");
        message.textContent = "You can still download the original file using the button above.";
        empty.append(heading, message);
        elements.text.append(empty);
    } else {
        resourcePages.forEach((page) => {
            const section = document.createElement("article");
            section.className = "text-page";
            section.id = `page-${page.page}`;
            const label = document.createElement("span");
            label.className = "text-page-label";
            const unit = currentResource.resource_type === "PPTX" ? "Slide" : "Page";
            label.textContent = `${unit} ${page.page}`;
            const text = document.createElement("div");
            text.className = "text-page-content";
            text.textContent = page.text;
            section.append(label, text);
            elements.text.append(section);
        });
    }
    elements.text.hidden = false;
    elements.loading.hidden = true;
}

async function loadBinaryPreview() {
    const response = await fetch(`${API_BASE_URL}/resources/${resourceId}/file`, { headers: authHeaders() });
    if (response.status === 401) return redirectToLogin();
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(formatApiError(data, "The file preview could not be loaded."));
    }
    previewObjectUrl = URL.createObjectURL(await response.blob());
    if (currentResource.resource_type === "PDF") {
        elements.frame.src = previewObjectUrl;
        elements.frame.hidden = false;
    } else if (currentResource.resource_type === "IMAGE") {
        elements.image.src = previewObjectUrl;
        elements.image.alt = currentResource.name;
        elements.image.hidden = false;
    } else {
        elements.video.src = previewObjectUrl;
        elements.video.hidden = false;
    }
    elements.loading.hidden = true;
}

async function renderPreview() {
    if (["PDF", "IMAGE", "VIDEO"].includes(currentResource.resource_type)) {
        await loadBinaryPreview();
        return;
    }
    renderTextPages();
}

function jumpToPage(pageNumber) {
    if (!pageNumber) return;
    if (currentResource.resource_type === "PDF" && previewObjectUrl) {
        elements.frame.src = `${previewObjectUrl}#page=${pageNumber}`;
        return;
    }
    document.getElementById(`page-${pageNumber}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function redirectToLogin() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.location.replace(new URL("index.html", window.location.href).toString());
}

async function loadViewer() {
    if (!accessToken) return redirectToLogin();
    if (!Number.isInteger(resourceId) || resourceId < 1) return showError("The document link is invalid.");
    try {
        const response = await fetch(`${API_BASE_URL}/resources/${resourceId}/viewer`, { headers: authHeaders() });
        if (response.status === 401) return redirectToLogin();
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(formatApiError(data, "The document could not be opened."));
        currentResource = data.resource;
        currentResource.topics ||= [];
        resourcePages = data.pages || [];
        renderMetadata();
        renderTopics();
        await renderPreview();
    } catch (error) {
        showError(error.message);
    }
}

elements.download.addEventListener("click", async () => {
    if (!currentResource) return;
    const originalLabel = elements.download.textContent;
    elements.download.disabled = true;
    elements.download.textContent = "Preparing…";
    try {
        const response = await fetch(`${API_BASE_URL}/resources/${resourceId}/download`, { headers: authHeaders() });
        if (response.status === 401) return redirectToLogin();
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(formatApiError(data, "The download could not be prepared."));
        }
        const downloadUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = currentResource.name;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);
    } catch (error) {
        showError(error.message);
    } finally {
        elements.download.disabled = false;
        elements.download.textContent = originalLabel;
    }
});

function closeRenameModal() {
    document.getElementById("viewerRenameModal").classList.remove("open");
}

elements.rename.addEventListener("click", () => {
    if (!currentResource) return;
    document.getElementById("viewerResourceName").value = currentResource.name;
    const notice = document.getElementById("viewerRenameNotice");
    notice.textContent = "";
    notice.className = "notice";
    document.getElementById("viewerRenameModal").classList.add("open");
});

document.getElementById("closeViewerRename").addEventListener("click", closeRenameModal);
document.getElementById("cancelViewerRename").addEventListener("click", closeRenameModal);
document.getElementById("viewerRenameModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeRenameModal();
});

document.getElementById("viewerRenameForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentResource) return;
    const submit = document.getElementById("saveViewerRename");
    const notice = document.getElementById("viewerRenameNotice");
    submit.disabled = true;
    try {
        const response = await fetch(`${API_BASE_URL}/resources/${resourceId}/name`, {
            method: "PATCH",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ name: document.getElementById("viewerResourceName").value }),
        });
        if (response.status === 401) return redirectToLogin();
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            notice.textContent = formatApiError(data);
            notice.className = "notice error";
            return;
        }
        currentResource = data;
        currentResource.topics ||= [];
        renderMetadata();
        closeRenameModal();
    } catch (error) {
        notice.textContent = error.message;
        notice.className = "notice error";
    } finally {
        submit.disabled = false;
    }
});

elements.topics.addEventListener("click", async (event) => {
    const jump = event.target.closest(".topic-jump");
    if (jump) return jumpToPage(Number(jump.dataset.page));

    const remove = event.target.closest(".topic-remove");
    if (!remove || !currentResource) return;
    const response = await fetch(`${API_BASE_URL}/resources/${resourceId}/topics/${remove.dataset.id}`, {
        method: "DELETE",
        headers: authHeaders(),
    });
    if (response.status === 401) return redirectToLogin();
    if (!response.ok) return setTopicNotice("The topic could not be removed.", "error");
    currentResource.topics = currentResource.topics.filter((topic) => topic.id !== Number(remove.dataset.id));
    renderTopics();
    setTopicNotice("Topic removed.", "success");
});

document.getElementById("topicForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentResource) return;
    const input = document.getElementById("newTopic");
    const response = await fetch(`${API_BASE_URL}/resources/${resourceId}/topics`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: input.value.trim(), pages: [] }),
    });
    if (response.status === 401) return redirectToLogin();
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setTopicNotice(formatApiError(data), "error");
    currentResource.topics.push(data);
    input.value = "";
    renderTopics();
    setTopicNotice("Topic added.", "success");
});

window.addEventListener("beforeunload", () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
});

loadViewer();
