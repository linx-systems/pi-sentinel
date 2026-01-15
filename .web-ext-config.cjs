// web-ext configuration
module.exports = {
    // Source directory
    sourceDir: './dist',

    // Build settings
    build: {
        overwriteDest: true,
    },

    // Linting settings
    lint: {
        output: 'text',
        metadata: false,
        // Warnings about innerHTML from Preact can be safely ignored
        // Preact only uses innerHTML for dangerouslySetInnerHTML prop which we don't use
        warningsAsErrors: false,
    },

    // Run settings
    run: {
        firefox: 'firefoxdeveloperedition',
        startUrl: ['about:debugging#/runtime/this-firefox'],
    },
};
