(function () {
  const sameOrigin = (url) => url.origin === window.location.origin;
  const isPageLink = (url) => url.pathname.endsWith(".html") || url.pathname === "/" || url.pathname === "/index.html";

  function navigate(url) {
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        window.location.href = url.toString();
      });
      return;
    }

    document.documentElement.classList.add("is-page-leaving");
    window.setTimeout(() => {
      window.location.href = url.toString();
    }, 140);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.classList.add("is-page-ready");
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const url = new URL(link.href, window.location.href);
    if (!sameOrigin(url) || !isPageLink(url) || url.href === window.location.href) return;

    event.preventDefault();
    navigate(url);
  });
})();
