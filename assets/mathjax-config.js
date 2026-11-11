/* MAE 2501 — shared MathJax config (identical across decks; load BEFORE the MathJax CDN script). */
// MathJax with SVG output: math renders as self-contained inline SVG, so it displays on the slides
  // AND survives the copy into reveal's separate speaker-notes window (KaTeX couldn't — no CSS there).
  window.MathJax = {
    // processEscapes: a literal `\$` in prose renders as a dollar sign and does NOT open a math
    // span. Explicit rather than relying on the default, because one unescaped `$` (a $20 prize in
    // a speaker note) silently swallowed the rest of seven manifests for every math-aware tool we
    // have. lint_manifest.py now catches the source-side mistake; this makes the rendered side safe.
    tex: { inlineMath: [['$','$']], displayMath: [['$$','$$']], processEscapes: true },
    svg: { fontCache: 'none' },        // inline glyph paths → each equation is fully self-contained
    // No assistive MathML: it's hidden on the slides but the speaker-notes window lacks that CSS,
    // so it would show the equation a second time. SVG alone is self-contained.
    options: { skipHtmlTags: ['script','noscript','style','textarea','pre','code'], enableAssistiveMml: false },
    startup: { typeset: false }        // we typeset after Reveal is ready
  };
