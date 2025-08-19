module.exports = {
    stories: ["../src/**/*.stories.mdx", "../src/**/*.stories.@(js|jsx|ts|tsx)"],
    addons: [
        "@storybook/addon-links",
        "@storybook/addon-essentials",
        "@storybook/addon-interactions",
    ],
    framework: {
        name: "@storybook/react-webpack5",
        options: {}
    },
    webpackFinal: async (config) => {
        // Ensure TS/TSX are handled (Storybook 8 + webpack5 may not pick up TS in some setups)
        config.module.rules.push({
            test: /\.tsx?$/,
            exclude: /node_modules/,
            use: [{
                loader: require.resolve('ts-loader'),
                options: { transpileOnly: true },
            }],
        });
        config.resolve.extensions = config.resolve.extensions || [];
        if (!config.resolve.extensions.includes('.ts')) config.resolve.extensions.push('.ts');
        if (!config.resolve.extensions.includes('.tsx')) config.resolve.extensions.push('.tsx');
        return config;
    },
    typescript: {
        // Avoid using react-docgen-typescript plugin which breaks with TS >=5
        reactDocgen: "react-docgen",
    },
};
