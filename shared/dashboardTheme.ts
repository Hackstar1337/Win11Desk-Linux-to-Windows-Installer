export const dashboardThemes = [
  {
    id: "cyan",
    name: "Cyan",
    primary: "#5ed8e9",
    strong: "#39c4dd",
    hover: "#91ebf5",
    link: "#8bcfe0",
    faint: "rgba(94,216,233,0.11)",
  },
  {
    id: "blue",
    name: "Blue",
    primary: "#89b5ff",
    strong: "#6b9cf2",
    hover: "#b1d0ff",
    link: "#aac9ff",
    faint: "rgba(137,181,255,0.11)",
  },
  {
    id: "violet",
    name: "Violet",
    primary: "#bca3ff",
    strong: "#a18aef",
    hover: "#d5c4ff",
    link: "#cdbcff",
    faint: "rgba(188,163,255,0.11)",
  },
  {
    id: "emerald",
    name: "Emerald",
    primary: "#69d7b1",
    strong: "#45bf96",
    hover: "#a0ebd0",
    link: "#8edcc2",
    faint: "rgba(105,215,177,0.11)",
  },
  {
    id: "amber",
    name: "Amber",
    primary: "#edc375",
    strong: "#d7a64f",
    hover: "#f6daa5",
    link: "#f0d39a",
    faint: "rgba(237,195,117,0.11)",
  },
  {
    id: "rose",
    name: "Rose",
    primary: "#f1a6c0",
    strong: "#df83a5",
    hover: "#facbdc",
    link: "#f5bdd2",
    faint: "rgba(241,166,192,0.11)",
  },
] as const;
export type DashboardThemeId = (typeof dashboardThemes)[number]["id"];
export const DASHBOARD_THEME_STORAGE = "win11desk.accent";
export function dashboardTheme(value: unknown) {
  return (
    dashboardThemes.find(theme => theme.id === value) || dashboardThemes[0]
  );
}
