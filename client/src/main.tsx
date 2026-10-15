import { createRoot } from "react-dom/client";
import App from "./App";
import { MotionConfig } from "framer-motion";
import "./index.css";
document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(<MotionConfig reducedMotion="user"><App /></MotionConfig>);
