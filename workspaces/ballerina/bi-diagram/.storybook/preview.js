import React from "react";
import "@vscode/codicons/dist/codicon.css";
import "./lightTheme.css";
import "./darkTheme.css";

export const parameters = {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
        matchers: {
            color: /(background|color)$/i,
            date: /Date$/,
        },
    },
};

export const decorators = [
    (Story, context) => {
    const themeClass = context.globals.theme === "Dark_Theme" ? "dark" : "light";
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(themeClass);
    return React.createElement(Story);
    },
];

export const globalTypes = {
    theme: {
        name: "Theme",
        description: "Global theme for components",
        defaultValue: "Light_Theme",
        toolbar: {
            icon: "circlehollow",
            items: ["Light_Theme", "Dark_Theme"],
        },
    },
};
