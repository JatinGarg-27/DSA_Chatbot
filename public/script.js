/* ================================================================= refs === */
const thread = document.getElementById("thread");
const hero = document.getElementById("hero");
const form = document.getElementById("chatForm");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const chatTitle = document.getElementById("chatTitle");
const newChatBtn = document.getElementById("newChat");
const menuToggle = document.getElementById("menuToggle");
const sidebar = document.getElementById("sidebar");

/* in-memory conversation, sent to the server for context */
let history = [];
let pending = false;

/* ================================================================ utils === */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

/* ---- inline markdown: code, bold, italic, links ---- */
function inlineMd(t) {
  t = escapeHtml(t);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  t = t.replace(
    /\[([^\]]+)\]\((https?:[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );
  return t;
}

/* ---- block markdown for a non-code segment: headings, lists, paragraphs ---- */
function renderBlocks(text) {
  const lines = text.split("\n");
  let html = "";
  let list = null; // 'ul' | 'ol'

  const closeList = () => {
    if (list) {
      html += "</" + list + ">";
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    let m;
    if ((m = line.match(/^#{1,4}\s+(.*)$/))) {
      closeList();
      html += "<h3>" + inlineMd(m[1]) + "</h3>";
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      if (list !== "ul") {
        closeList();
        list = "ul";
        html += "<ul>";
      }
      html += "<li>" + inlineMd(m[1]) + "</li>";
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      if (list !== "ol") {
        closeList();
        list = "ol";
        html += "<ol>";
      }
      html += "<li>" + inlineMd(m[1]) + "</li>";
    } else {
      closeList();
      html += "<p>" + inlineMd(line) + "</p>";
    }
  }
  closeList();
  return html;
}

/* ---- full markdown: split on ``` fences, alternate text / code ---- */
function renderMarkdown(md) {
  const parts = String(md).split("```");
  let html = "";

  for (let k = 0; k < parts.length; k++) {
    if (k % 2 === 1) {
      // inside a fenced code block
      let seg = parts[k].replace(/^\n/, "");
      const nl = seg.indexOf("\n");
      const firstLine = nl === -1 ? seg : seg.slice(0, nl);
      let lang = "";
      let code = seg;
      if (nl !== -1 && /^[a-zA-Z0-9+#.-]{1,15}$/.test(firstLine.trim())) {
        lang = firstLine.trim();
        code = seg.slice(nl + 1);
      }
      code = code.replace(/\n$/, "");
      html +=
        "<pre><code" +
        (lang ? ' class="lang-' + lang + '"' : "") +
        ">" +
        escapeHtml(code) +
        "</code></pre>";
    } else {
      html += renderBlocks(parts[k]);
    }
  }
  return html;
}

/* =============================================================== render === */
function addMessage(role, text) {
  hero?.remove();

  const wrap = document.createElement("div");
  const isUser = role === "user";
  wrap.className = "msg msg--" + (isUser ? "user" : "bot");
  wrap.innerHTML =
    '<div class="msg__head">' +
    '<span class="msg__avatar">' +
    (isUser ? "You" : "AI") +
    "</span>" +
    '<span class="msg__name">' +
    (isUser ? "You" : "DSA Instructor") +
    "</span></div>" +
    '<div class="msg__body">' +
    (isUser ? "<p>" + escapeHtml(text) + "</p>" : renderMarkdown(text)) +
    "</div>";
  thread.appendChild(wrap);
  scrollDown();
  return wrap;
}

function botShell(innerHtml) {
  const el = document.createElement("div");
  el.className = "msg msg--bot";
  el.innerHTML =
    '<div class="msg__head">' +
    '<span class="msg__avatar">AI</span>' +
    '<span class="msg__name">DSA Instructor</span></div>' +
    innerHtml;
  thread.appendChild(el);
  scrollDown();
  return el;
}

function showTyping() {
  const el = botShell(
    '<div class="typing"><span></span><span></span><span></span></div>'
  );
  el.id = "typing";
}

function clearTyping() {
  document.getElementById("typing")?.remove();
}

function showError(msg, detail) {
  botShell(
    '<div class="msg__error">' +
      escapeHtml(msg) +
      (detail ? "<br><small>" + escapeHtml(detail) + "</small>" : "") +
      "</div>"
  );
}

function scrollDown() {
  thread.scrollTop = thread.scrollHeight;
}

function clip(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/* ================================================================= send === */
async function send(text) {
  text = (text || "").trim();
  if (pending || !text) return;
  pending = true;
  sendBtn.disabled = true;

  addMessage("user", text);
  history.push({ role: "user", text: text });

  if (chatTitle.textContent === "New session") {
    chatTitle.textContent = clip(text, 48);
  }

  input.value = "";
  autoGrow();
  showTyping();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: history.slice(0, -1) }),
    });

    const ctype = res.headers.get("content-type") || "";

    // error responses come back as JSON
    if (!res.ok || ctype.includes("application/json")) {
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { error: "Server did not return JSON.", detail: raw.slice(0, 200) };
      }
      clearTyping();
      showError(
        data.error || "Request failed (" + res.status + ").",
        data.detail
      );
      return;
    }

    // success: stream plain text into a live-updating bubble
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    let bodyEl = null;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const piece = decoder.decode(value, { stream: true });
      if (!piece) continue;
      if (!bodyEl) {
        clearTyping();
        bodyEl = addMessage("bot", "").querySelector(".msg__body");
      }
      acc += piece;
      bodyEl.innerHTML = renderMarkdown(acc);
      scrollDown();
    }
    acc += decoder.decode();

    if (!bodyEl) {
      clearTyping();
      addMessage("bot", "(empty response)");
    } else {
      bodyEl.innerHTML = renderMarkdown(acc);
    }
    history.push({ role: "assistant", text: acc });
  } catch (err) {
    clearTyping();
    showError("Could not reach the server.", String(err));
  } finally {
    pending = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

/* ============================================================== events === */
form.addEventListener("submit", (e) => {
  e.preventDefault();
  send(input.value);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send(input.value);
  }
});

function autoGrow() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}
input.addEventListener("input", autoGrow);

document.querySelectorAll(".chip, .topic").forEach((b) => {
  b.addEventListener("click", () => {
    input.value = b.textContent.trim();
    autoGrow();
    input.focus();
    if (b.classList.contains("chip")) send(input.value);
  });
});

newChatBtn.addEventListener("click", () => {
  history = [];
  pending = false;
  sendBtn.disabled = false;
  location.reload();
});

/* mobile sidebar */
menuToggle?.addEventListener("click", () => {
  const open = sidebar.classList.toggle("is-open");
  if (open) {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.addEventListener("click", closeSidebar);
    document.body.appendChild(scrim);
  } else {
    closeSidebar();
  }
});

function closeSidebar() {
  sidebar.classList.remove("is-open");
  document.querySelector(".scrim")?.remove();
}

input.focus();
