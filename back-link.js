// Smart "back" link: if we arrived from another page on this site, go to
// the actual previous page instead of always landing on home.
document.querySelectorAll(".masthead-eyebrow[href]").forEach((link) => {
  link.addEventListener("click", (e) => {
    if (document.referrer && new URL(document.referrer).origin === location.origin) {
      e.preventDefault();
      history.back();
    }
  });
});
