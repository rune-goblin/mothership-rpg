<script>
  let { component: Body, props, initial, close, report } = $props();

  // Capturing it once is the point: `initial` is where the dialog opens, not a channel it listens on.
  // svelte-ignore state_referenced_locally
  let value = $state(initial);
</script>

<Body
  {...props}
  {close}
  {value}
  onchange={(next) => {
    value = next;
    report(next);
  }}
/>
