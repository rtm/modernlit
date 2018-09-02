document.addEventListener(
  "DOMContentLoaded", () =>
    document.querySelectorAll('a[href^="#"]').forEach(
      anchor =>
        anchor.addEventListener('click', function(e) {
          e.preventDefault();

          var elt = document.querySelector(this.getAttribute('href'));

          elt.scrollIntoView({behavior: 'smooth'});
          elt.classList.add("highlight");
          window.setTimeout(() => elt.classList.remove("highlight"), 2000);
        })));
