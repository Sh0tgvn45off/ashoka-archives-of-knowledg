function makeCuriousDistribution() {
    // Implement distribution logic based on game requirements
    const distribution = []; // Replace with actual calculation logic
    return distribution;
}

// Initialize G.runCuriousPerLevel only when starting a new run
function startGame() {
    G.runCuriousPerLevel = makeCuriousDistribution();
    // Other start game logic
}

// Ensure use of G.runCuriousPerLevel[level-1] in startLevel
function startLevel(level) {
    const curiousToPlace = G.runCuriousPerLevel[level - 1];
    placeCurious(curiousToPlace);
    // Existing level logic
}
