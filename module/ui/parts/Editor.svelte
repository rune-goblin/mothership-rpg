<script>
  // <prose-mirror> saving dispatches a bubbling change event; the sheet's form handler
  // picks it up, so there's no explicit save handler wired here.
  let { name, value, enriched, uuid } = $props();

  function proseMirror(node) {
    const editor = foundry.applications.elements.HTMLProseMirrorElement.create({
      name,
      value,
      enriched,
      toggled: true,
      collaborate: false,
      documentUUID: uuid,
    });
    node.replaceChildren(editor);

    // Foundry reveals the edit button on `prose-mirror:hover` alone, from a rule outside every
    // layer — so no layered rule can outrank it, and css/ holds !important at zero. An empty
    // description has nothing to hover, which leaves the only way in undiscoverable.
    const toggle = editor.querySelector('button.toggle');
    if (toggle !== null) toggle.style.display = 'block';

    return () => editor.remove();
  }
</script>

<!-- display:contents keeps this out of layout so <prose-mirror>, which carries .editor
     itself, is the direct child the CSS sizes. -->
<div class="editor-host" {@attach proseMirror}></div>

<style>
  @layer system {
    .editor-host {
      display: contents;
    }
  }
</style>
