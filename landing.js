const menuButton = document.querySelector("#landingMenuButton");
const nav = document.querySelector(".landing-nav");

if (window.location.protocol === "file:") {
  document.querySelector("#localRunNotice").hidden = false;
  document.querySelectorAll('a[href="dashboard.html"]').forEach(link => {
    link.href = "http://localhost:4173/dashboard.html";
  });
}

menuButton.addEventListener("click", () => {
  const expanded = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!expanded));
  nav.classList.toggle("open", !expanded);
});

nav.addEventListener("click", event => {
  if (!event.target.closest("a")) return;
  menuButton.setAttribute("aria-expanded", "false");
  nav.classList.remove("open");
});
