const prompts = ["living room", "bedroom", "kitchen"];
async function run() {
  const promises = prompts.map(p => fetch(`https://image.pollinations.ai/prompt/${p}?width=800&height=600&nologo=true`));
  const results = await Promise.allSettled(promises);
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`Prompt ${i} status: ${r.value.status}`);
    } else {
      console.log(`Prompt ${i} failed: ${r.reason}`);
    }
  });
}
run();
