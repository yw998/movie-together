import { NEW_YORK_TIMEZONE, type Cinema } from "../types/schedule";

export const cinemaCatalog: Cinema[] = [
  {
    id: "metrograph", name: "Metrograph", officialUrl: "https://metrograph.com/",
    scheduleUrl: "https://metrograph.com/film/", timezone: NEW_YORK_TIMEZONE,
    enabled: true, color: "#ef5a3c",
  },
  {
    id: "film-forum", name: "Film Forum", officialUrl: "https://filmforum.org/",
    scheduleUrl: "https://my.filmforum.org/", timezone: NEW_YORK_TIMEZONE,
    enabled: true, color: "#38a169",
  },
  {
    id: "ifc-center", name: "IFC Center", officialUrl: "https://www.ifccenter.com/",
    scheduleUrl: "https://www.ifccenter.com/films/", timezone: NEW_YORK_TIMEZONE,
    enabled: true, color: "#805ad5",
  },
  {
    id: "roxy-cinema", name: "Roxy Cinema", officialUrl: "https://www.roxycinemanewyork.com/",
    scheduleUrl: "https://www.roxycinemanewyork.com/now-showing/", timezone: NEW_YORK_TIMEZONE,
    enabled: true, color: "#d69e2e",
  },
  {
    id: "paris-theater", name: "Paris Theater", officialUrl: "https://www.paristheaternyc.com/",
    scheduleUrl: "https://www.paristheaternyc.com/", timezone: NEW_YORK_TIMEZONE,
    enabled: true, color: "#3182ce",
  },
  {
    id: "film-at-lincoln-center", name: "Film at Lincoln Center", officialUrl: "https://filmlinc.org/",
    scheduleUrl: "https://www.filmlinc.org/now-playing/?tab=schedule", timezone: NEW_YORK_TIMEZONE,
    enabled: true, color: "#b83280",
  },
];
