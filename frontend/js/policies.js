/* ============================================================
   InsureBot — policies.js
   Handles:
     1. Policy analyzer  (upload PDF or paste text → analyze → show results)
     2. Policy advice    (claim-type + description → AI advice + search results)
     3. My Policies list

   Depends on api.js (window.API, window.toast, window.withErrorToast)
   and auth.js (window.AuthUI).

   Markup hooks:

   ── Analyzer section ──
     <!-- Toggle between file upload and text paste -->
     <div class="tabs" id="policy-input-tabs">
       <button class="tab active" data-tab="file-tab">Upload PDF</button>
       <button class="tab"        data-tab="text-tab">Paste Text</button>
     </div>

     <div id="file-tab" class="tab-panel">
       <form id="policy-file-form">
         <input type="file" id="policy-file" accept=".pdf,.txt" required>
         <button type="submit" id="policy-file-submit">Analyze PDF</button>
       </form>
     </div>

     <div id="text-tab" class="tab-panel" hidden>
       <form id="policy-text-form">
         <textarea id="policy-text-input" rows="8" required></textarea>
         <button type="submit" id="policy-text-submit">Analyze Text</button>
       </form>
     </div>

     <!-- Results (hidden until analysis done) -->
     <section id="policy-results" hidden>
       <div id="policy-summary-text"></div>
       <div id="policy-extra-fields"></div>
     </section>

   ── Advice section ──
     <form id="advice-form">
       <select id="advice-claim-type">
         <option value="car">Car</option>
         <option value="house">House</option>
         <option value="health">Health</option>
         <option value="life">Life</option>
         <option value="other">Other</option>
       </select>
       <textarea id="advice-description" rows="4" required></textarea>
       <textarea id="advice-policy-details" rows="3"></textarea>
       <button type="submit" id="advice-submit">Get Advice</button>
     </form>

     <section id="advice-results" hidden>
       <div id="advice-content"></div>
       <div id="advice-search-results"></div>
     </section>

   ── My Policies page ──
     <div id="my-policies-container"></div>
   ============================================================ */

(function () {
  "use strict";

  // ─────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────

  function setLoading(button, isLoading, text) {
    if (!button) return;
    if (isLoading) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.innerHTML = `<span class="spinner"></span> ${text || "Please wait…"}`;
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalText || button.textContent;
    }
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  }

  /**
   * Generic renderer for opaque nested objects/arrays from the API.
   * Returns an HTML string.
   */
  function renderOpaque(obj, depth) {
    depth = depth || 0;
    if (obj === null || obj === undefined) return "<em>—</em>";
    if (typeof obj !== "object") return `<span>${obj}</span>`;

    if (Array.isArray(obj)) {
      if (!obj.length) return "<em>None</em>";
      return `<ul class="opaque-list">${obj.map((item) => `<li>${renderOpaque(item, depth + 1)}</li>`).join("")}</ul>`;
    }

    const entries = Object.entries(obj);
    if (!entries.length) return "<em>Empty</em>";
    return entries.map(([k, v]) => {
      const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return `
        <div class="kv-row${depth > 0 ? " kv-nested" : ""}">
          <span class="kv-label">${label}</span>
          <span class="kv-value">${renderOpaque(v, depth + 1)}</span>
        </div>`;
    }).join("");
  }

  // ─────────────────────────────────────────
  // Tab switcher (shared utility)
  // ─────────────────────────────────────────

  function initTabs(tabsRoot) {
    if (!tabsRoot) return;
    const tabs   = tabsRoot.querySelectorAll(".tab");
    const panels = tabsRoot
      .parentElement
      ?.querySelectorAll(".tab-panel") || [];

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        const targetId = tab.dataset.tab;
        panels.forEach((panel) => {
          panel.hidden = panel.id !== targetId;
        });
      });
    });
  }

  // ─────────────────────────────────────────
  // 1. Policy Analyzer
  // ─────────────────────────────────────────

  function initPolicyAnalyzer() {
    const fileForm   = document.getElementById("policy-file-form");
    const textForm   = document.getElementById("policy-text-form");
    const tabsRoot   = document.getElementById("policy-input-tabs");
    const resultsEl  = document.getElementById("policy-results");
    const summaryEl  = document.getElementById("policy-summary-text");
    const extraEl    = document.getElementById("policy-extra-fields");

    if (!fileForm && !textForm) return;

    initTabs(tabsRoot);

    function showResults(analysis) {
      if (!analysis) {
        toast("Analysis returned no data.", "error");
        return;
      }

      // Always render policy_summary prominently if present
      const summary = analysis.policy_summary
        || analysis.summary
        || null;

      if (summaryEl) {
        summaryEl.innerHTML = summary
          ? `<div class="alert-info">${summary}</div>`
          : `<div class="alert-info"><em>No summary returned.</em></div>`;
      }

      // Render everything else generically
      if (extraEl) {
        const skipKeys = ["policy_summary", "summary"];
        const rest = Object.fromEntries(
          Object.entries(analysis).filter(([k]) => !skipKeys.includes(k))
        );
        extraEl.innerHTML = Object.keys(rest).length
          ? renderOpaque(rest)
          : "";
      }

      if (resultsEl) resultsEl.hidden = false;
      // Scroll into view smoothly
      resultsEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // ── Upload PDF ──
    if (fileForm) {
      const fileInput = document.getElementById("policy-file");
      const submitBtn = document.getElementById("policy-file-submit");

      fileForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const file = fileInput?.files?.[0];
        if (!file) {
          toast("Please select a PDF or text file.", "warning");
          return;
        }

        setLoading(submitBtn, true, "Analyzing PDF…");
        if (resultsEl) resultsEl.hidden = true;

        try {
          const res = await API.policies.analyzeFile(file);
          if (!res || !res.success) {
            toast("Policy analysis returned an unexpected response.", "error");
            return;
          }
          showResults(res.analysis || {});
        } catch (err) {
          toast(err.message || "Policy analysis failed.", "error");
        } finally {
          setLoading(submitBtn, false);
        }
      });
    }

    // ── Paste Text ──
    if (textForm) {
      const textArea  = document.getElementById("policy-text-input");
      const submitBtn = document.getElementById("policy-text-submit");

      textForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const policyText = textArea?.value?.trim();
        if (!policyText) {
          toast("Please paste some policy text.", "warning");
          return;
        }

        setLoading(submitBtn, true, "Analyzing text…");
        if (resultsEl) resultsEl.hidden = true;

        try {
          const res = await API.policies.analyzeText(policyText);
          if (!res || !res.success) {
            toast("Policy analysis returned an unexpected response.", "error");
            return;
          }
          showResults(res.analysis || {});
        } catch (err) {
          toast(err.message || "Policy analysis failed.", "error");
        } finally {
          setLoading(submitBtn, false);
        }
      });
    }
  }

  // ─────────────────────────────────────────
  // 2. Policy Advice
  // ─────────────────────────────────────────

  function initPolicyAdvice() {
    const form          = document.getElementById("advice-form");
    if (!form) return;

    const submitBtn     = document.getElementById("advice-submit");
    const resultsEl     = document.getElementById("advice-results");
    const adviceContent = document.getElementById("advice-content");
    const searchContent = document.getElementById("advice-search-results");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const claimType   = document.getElementById("advice-claim-type")?.value;
      const description = document.getElementById("advice-description")?.value?.trim();
      const policyDetails = document.getElementById("advice-policy-details")?.value?.trim() || undefined;

      if (!claimType || !description) {
        toast("Claim type and description are required.", "warning");
        return;
      }

      setLoading(submitBtn, true, "Fetching advice…");
      if (resultsEl) resultsEl.hidden = true;

      const payload = { claim_type: claimType, description };
      if (policyDetails) payload.policy_details = policyDetails;

      try {
        const res = await API.policies.advice(payload);
        if (!res || !res.success) {
          toast("Advice endpoint returned an unexpected response.", "error");
          return;
        }

        if (adviceContent) {
          const advice = res.advice || {};
          // If advice is a plain string, wrap it; otherwise render opaque
          adviceContent.innerHTML = typeof advice === "string"
            ? `<div class="advice-block">${advice}</div>`
            : renderOpaque(advice);
        }

        if (searchContent) {
          const sr = res.search_results;
          searchContent.innerHTML = sr && Object.keys(sr).length
            ? `<div class="search-results-block">${renderOpaque(sr)}</div>`
            : `<p class="muted">No additional search results.</p>`;
        }

        if (resultsEl) resultsEl.hidden = false;
        resultsEl?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (err) {
        toast(err.message || "Failed to get advice.", "error");
      } finally {
        setLoading(submitBtn, false);
      }
    });
  }

  // ─────────────────────────────────────────
  // 3. My Policies List
  // ─────────────────────────────────────────

  function initMyPolicies() {
    const container = document.getElementById("my-policies-container");
    if (!container) return;

    loadMyPolicies(container);
  }

  async function loadMyPolicies(container) {
    container.innerHTML = `<div class="skeleton skeleton-table"></div>`;

    try {
      const res      = await API.policies.mine();
      const policies = res?.policies || [];

      if (!policies.length) {
        container.innerHTML = `
          <div class="alert-info">
            No policies yet. <a href="/policies.html">Analyze your first policy →</a>
          </div>`;
        return;
      }

      container.innerHTML = buildPoliciesTable(policies);
    } catch (err) {
      container.innerHTML = `<div class="alert-danger">Failed to load policies: ${err.message}</div>`;
    }
  }

  function buildPoliciesTable(policies) {
    const rows = policies.map((p) => `
      <tr>
        <td>#${p.id}</td>
        <td>${p.filename || "Pasted text"}</td>
        <td class="policy-summary-cell">${p.summary || "<em>No summary</em>"}</td>
        <td>${fmtDate(p.uploaded_at)}</td>
      </tr>
    `).join("");

    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>File / Source</th>
              <th>Summary</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ─────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", () => {
    initPolicyAnalyzer();
    initPolicyAdvice();
    initMyPolicies();
  });

  window.PoliciesUI = {
    loadMyPolicies,
    initPolicyAnalyzer,
    initPolicyAdvice,
  };
})();