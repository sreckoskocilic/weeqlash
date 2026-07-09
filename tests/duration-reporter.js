export default class DurationReporter {
  onEnd(result) {
    console.log(`Duration: ${Math.round(result.duration / 1000)}s`);
  }
}
