// Fixture for the subprocess runner tests: writes to both streams and exits 0.
const arg = process.argv[2] ?? "";
process.stdout.write(`STDOUT:${arg}\n`);
process.stderr.write(`STDERR:${arg}\n`);
