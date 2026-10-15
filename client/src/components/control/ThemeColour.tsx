import { useLayoutEffect, useState, useEffect, useId } from "react";
import { Palette } from "lucide-react";
import {
  dashboardThemes,
  dashboardTheme,
  DASHBOARD_THEME_STORAGE,
  type DashboardThemeId,
} from "../../../../shared/dashboardTheme";
function storedTheme(): DashboardThemeId {
  try {
    return dashboardTheme(
      localStorage.getItem(DASHBOARD_THEME_STORAGE) || "violet"
    ).id;
  } catch {
    return "violet";
  }
}
export default function ThemeColour() {
  const inputId = `dashboard-theme-${useId()}`;
  const [selected, setSelected] = useState<DashboardThemeId>(storedTheme);
  useEffect(() => {
    const sync = (event: Event) => {
      if (event instanceof CustomEvent)
        setSelected(dashboardTheme(event.detail).id);
      else if (
        event instanceof StorageEvent &&
        event.key === DASHBOARD_THEME_STORAGE
      )
        setSelected(dashboardTheme(event.newValue || "violet").id);
    };
    window.addEventListener("win11desk-theme-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("win11desk-theme-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
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
      <label htmlFor={inputId}>
        <Palette size={13} />
        Theme colour
      </label>
      <div className="theme-colour-input">
        <span className="theme-colour-swatch" aria-hidden="true" />
        <select
          id={inputId}
          value={selected}
          onChange={e => {
            const id = dashboardTheme(e.target.value).id;
            setSelected(id);
            window.dispatchEvent(
              new CustomEvent("win11desk-theme-changed", { detail: id })
            );
          }}
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
