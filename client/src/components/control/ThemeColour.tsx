import { useLayoutEffect, useState } from "react";
import { Palette } from "lucide-react";
import {
  dashboardThemes,
  dashboardTheme,
  DASHBOARD_THEME_STORAGE,
  type DashboardThemeId,
} from "../../../../shared/dashboardTheme";
function storedTheme(): DashboardThemeId {
  try {
    return dashboardTheme(localStorage.getItem(DASHBOARD_THEME_STORAGE)).id;
  } catch {
    return "cyan";
  }
}
export default function ThemeColour() {
  const [selected, setSelected] = useState<DashboardThemeId>(storedTheme);
  useLayoutEffect(() => {
    const theme = dashboardTheme(selected),
      root = document.documentElement;
    root.dataset.accent = theme.id;
    root.style.setProperty("--primary", theme.primary);
    root.style.setProperty("--primary-strong", theme.strong);
    root.style.setProperty("--primary-faint", theme.faint);
    root.style.setProperty("--accent-hover", theme.hover);
    root.style.setProperty("--accent-link", theme.link);
    try {
      localStorage.setItem(DASHBOARD_THEME_STORAGE, theme.id);
    } catch {
      /* Private browser storage may be unavailable; colour still works. */
    }
  }, [selected]);
  return (
    <div className="theme-colour-control">
      <label htmlFor="dashboard-theme">
        <Palette size={13} />
        Theme colour
      </label>
      <div className="theme-colour-input">
        <span className="theme-colour-swatch" aria-hidden="true" />
        <select
          id="dashboard-theme"
          value={selected}
          onChange={e => setSelected(dashboardTheme(e.target.value).id)}
        >
          {dashboardThemes.map(theme => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </select>
      </div>
      <small>Saved in this browser</small>
    </div>
  );
}
