# Documentation site

The static site in `docs/`, served by GitHub Pages at factum-orm.com. Every page is hand-written HTML over one stylesheet, `docs/assets/site.css`, with the same header and footer copied into each file.

## The blog

Long-form articles about fact-based modelling and agents, published as `docs/blog.html` (the index), one `docs/blog-<slug>.html` page per article, and an RSS feed at `docs/blog.xml`.

The articles are written in markdown for the book project and published to Substack as well; the site pages are rendered from that markdown rather than edited separately, so a correction belongs in the source article first. Each post is dated by when its article was first written, not when it was rendered, and the index lists posts newest first.

A post's figures live in `docs/assets/blog/<slug>/`, so a post never reaches into another page's assets. Adding a page to the site means adding its `Blog` nav link, footer link and sitemap entry like any other page.
