/** Entry of the browser bundle: the stylesheet and the app. */
import "./styles/globals.css";
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
