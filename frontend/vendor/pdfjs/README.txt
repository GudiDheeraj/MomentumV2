pdf.js 4.0.379, vendored from the pdfjs-dist npm package.

Only the two files the preview needs are kept: the library and its worker.
They are renamed from .mjs to .js so a static server hands them back as
text/javascript — .mjs is not in Python's mimetypes table, and the module and
its worker both refuse to load under application/octet-stream.

They are vendored rather than loaded from a CDN because the preview has to work
offline and inside Docker, and because CDN-loaded rendering libraries have
already caused an outage in this project once.
