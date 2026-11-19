/** Entry of the browser bundle: global styles and the app. */
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const root = document.getElementById("root");
if (root)
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
