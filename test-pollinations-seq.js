const prompts = ["living room", "bedroom", "kitchen"];
async function run() {
  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    try {
      const res = await fetch(`https://image.pollinations.ai/prompt/${p}?width=800&height=600&nologo=true`);
      console.log(`Prompt ${i} status: ${res.status}`);
    } catch (e) {
      console.log(`Prompt ${i} failed: ${e}`);
    }
  }
}
run();
