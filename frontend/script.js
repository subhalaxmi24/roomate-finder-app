/* Roomie frontend: all listing data is loaded from the Express API. */
(() => {
  "use strict";
  const API_BASE = window.ROOMIE_API_BASE || "http://localhost:3000/api";
  const grid = document.getElementById("listing-grid");
  const template = document.getElementById("listing-template");
  const statusMessage = document.getElementById("status-message");
  const resultsCount = document.getElementById("results-count");
  const emptyState = document.getElementById("empty-state");
  const filterForm = document.getElementById("filter-form");
  const listingForm = document.getElementById("listing-form");
  const formFeedback = document.getElementById("form-feedback");
  const menuToggle = document.getElementById("menu-toggle");
  let listings = [];
  let activeFilters = {};
  const escapeText = (value) => String(value ?? "");
  const money = (amount) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(amount));

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) }
      });
    } catch (error) {
      throw new Error("Cannot reach the backend. Start the server and check your network connection.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }

  function showStatus(message, type = "") {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`.trim();
  }

  function setLoading() {
    grid.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const skeleton = document.createElement("div");
      skeleton.className = "loading-skeleton";
      skeleton.setAttribute("aria-label", "Loading listing");
      grid.append(skeleton);
    }
    emptyState.hidden = true;
  }

  function addText(parent, selector, value) {
    const node = parent.querySelector(selector);
    node.textContent = escapeText(value);
    return node;
  }

  function renderListings(items) {
    grid.replaceChildren();
    emptyState.hidden = items.length !== 0;
    resultsCount.textContent = `${items.length} ${items.length === 1 ? "place" : "places"} to explore`;
    items.forEach((item, index) => {
      const fragment = template.content.cloneNode(true);
      const card = fragment.querySelector(".listing-card");
      card.dataset.id = item.id;
      addText(card, ".room-badge", item.room_type);
      addText(card, ".listing-location", `⌖  ${item.location}`);
      addText(card, ".listing-title", item.title);
      addText(card, ".listing-description", item.description);
      addText(card, ".room-type", item.room_type);
      const rent = card.querySelector(".listing-rent");
      rent.textContent = `${money(item.rent)} `;
      const perMonth = document.createElement("small");
      perMonth.textContent = "/ month";
      rent.append(perMonth);
      const visual = card.querySelector(".listing-visual");
      visual.setAttribute("aria-label", `Illustration for ${item.title}`);
      const contact = card.querySelector(".contact-button");
      contact.addEventListener("click", () => {
        const subject = encodeURIComponent(`Roomie listing enquiry: ${item.title}`);
        const body = encodeURIComponent(`Hi ${item.contact_name},\n\nI saw your Roomie listing "${item.title}" in ${item.location} and would like to know more.\n\nThanks!`);
        window.location.href = `mailto:${encodeURIComponent(item.contact_email)}?subject=${subject}&body=${body}`;
      });
      // Editing/deleting is limited to the browser session that created a listing.
      const edit = card.querySelector(".edit-button");
      const remove = card.querySelector(".delete-button");
      if (item._createdHere) {
        edit.hidden = false; remove.hidden = false;
        edit.addEventListener("click", () => populateEditForm(item));
        remove.addEventListener("click", async () => {
          if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
          try {
            await api(`/listings/${encodeURIComponent(item.id)}`, { method: "DELETE" });
            showFormFeedback("Listing deleted.", "success");
            await loadListings();
          } catch (error) { showFormFeedback(error.message, "error"); }
        });
      }
      grid.append(fragment);
    });
  }

  async function loadListings() {
    setLoading();
    showStatus("");
    try {
      const params = new URLSearchParams();
      if (activeFilters.location) params.set("location", activeFilters.location);
      if (activeFilters.maxRent) params.set("maxRent", activeFilters.maxRent);
      if (activeFilters.roomType) params.set("roomType", activeFilters.roomType);
      const result = await api(`/listings${params.size ? `?${params}` : ""}`);
      listings = result.data || [];
      renderListings(listings);
      if (!listings.length) showStatus("No matching listings in the database. Try another search or post a place.");
    } catch (error) {
      grid.replaceChildren();
      resultsCount.textContent = "Listings unavailable";
      showStatus(`${error.message} Check the README setup steps.`, "error");
      emptyState.hidden = false;
      emptyState.querySelector("h3").textContent = "We couldn't load listings";
      emptyState.querySelector("p").textContent = "Make sure the backend is running and Supabase is configured, then refresh.";
    }
  }

  function showFormFeedback(message, type) {
    formFeedback.textContent = message;
    formFeedback.className = `form-feedback ${type}`;
  }

  function populateEditForm(item) {
    listingForm.elements.title.value = item.title;
    listingForm.elements.location.value = item.location;
    listingForm.elements.rent.value = item.rent;
    listingForm.elements.room_type.value = item.room_type;
    listingForm.elements.description.value = item.description;
    listingForm.elements.contact_name.value = item.contact_name;
    listingForm.elements.contact_email.value = item.contact_email;
    listingForm.dataset.editId = item.id;
    listingForm.querySelector(".submit-label").textContent = "Save listing changes";
    showFormFeedback("Editing your listing. Submit to save changes, or reload to cancel.", "");
    document.getElementById("post").scrollIntoView({ behavior: "smooth" });
  }

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const rent = document.getElementById("filter-rent").value.trim();
    if (rent && (!Number.isFinite(Number(rent)) || Number(rent) < 0)) {
      showStatus("Enter a valid non-negative maximum rent.", "error");
      return;
    }
    activeFilters = {
      location: document.getElementById("filter-location").value.trim(),
      maxRent: rent,
      roomType: document.getElementById("filter-room").value
    };
    loadListings();
  });

  document.getElementById("clear-filters").addEventListener("click", () => {
    filterForm.reset();
    activeFilters = {};
    loadListings();
  });

  listingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!listingForm.reportValidity()) return;
    const formData = new FormData(listingForm);
    const payload = Object.fromEntries(formData.entries());
    payload.rent = Number(payload.rent);
    const editId = listingForm.dataset.editId;
    const submitButton = listingForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.querySelector(".submit-label").textContent = editId ? "Saving changes…" : "Publishing…";
    showFormFeedback("", "");
    try {
      const result = await api(editId ? `/listings/${encodeURIComponent(editId)}` : "/listings", {
        method: editId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      const saved = result.data;
      // Session marker only controls which UI actions are displayed; it is not authorization.
      const marked = { ...saved, _createdHere: true };
      listings = [marked, ...listings.filter((item) => item.id !== marked.id)];
      listingForm.reset();
      delete listingForm.dataset.editId;
      listingForm.querySelector(".submit-label").textContent = "Publish my listing";
      showFormFeedback(editId ? "Your listing has been updated." : "Your listing is live in the database!", "success");
      activeFilters = {};
      filterForm.reset();
      await loadListings();
      // Preserve the session-only marker for this browser's own listing.
      const index = listings.findIndex((item) => item.id === marked.id);
      if (index >= 0) listings[index]._createdHere = true;
      renderListings(listings);
    } catch (error) {
      showFormFeedback(error.message, "error");
    } finally {
      submitButton.disabled = false;
      submitButton.querySelector(".submit-label").textContent = listingForm.dataset.editId ? "Save listing changes" : "Publish my listing";
    }
  });

  menuToggle.addEventListener("click", () => {
    const nav = document.querySelector(".nav-links");
    const open = nav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll(".nav-links a").forEach((link) => link.addEventListener("click", () => {
    document.querySelector(".nav-links").classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  }));
  document.getElementById("year").textContent = new Date().getFullYear();
  loadListings();
})();
