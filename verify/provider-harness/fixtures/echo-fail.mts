// Fixture for the subprocess runner tests: a script that RAN and then failed, which must stay
// distinguishable from a process that never started.
process.stdout.write("about to fail\n");
process.stderr.write("deliberate failure\n");
process.exit(3);
