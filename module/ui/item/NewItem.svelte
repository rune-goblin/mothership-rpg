<script>
  // The item sheet's own form, standing over a draft no document holds yet. A real sheet has
  // Foundry submit the form for it; here every named field is read back out of the DOM on change,
  // which is also why a body that owns its own write (Weapon's damage modes) stops the event.
  let { store, component: Form } = $props();

  const valueOf = (input) => {
    if (input.type === 'checkbox') return input.checked;
    return input.dataset.dtype === 'Number' ? Number(input.value) : input.value;
  };

  function harvest(root) {
    const onchange = () => {
      const changes = {};
      // The attribute, not the property: `<prose-mirror>` carries the name but is not an <input>.
      for (const field of root.querySelectorAll('[name]')) {
        changes[field.getAttribute('name')] = valueOf(field);
      }
      void store.document.update(changes);
    };
    root.addEventListener('change', onchange);
    return () => root.removeEventListener('change', onchange);
  }
</script>

<div class="new-item" {@attach harvest}>
  <Form {store} />
</div>

<style>
  @layer system {
    .new-item {
      --new-item-gap: var(--space-8);

      display: flex;
      flex-direction: column;
      gap: var(--new-item-gap);
    }
  }
</style>
