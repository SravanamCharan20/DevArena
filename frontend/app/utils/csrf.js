const CSRF_COOKIE_NAME = "csrfToken";

export const getCookieValue = (name) => {
  if (typeof document === "undefined") return "";

  const target = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));

  if (!target) return "";

  try {
    return decodeURIComponent(target.slice(name.length + 1));
  } catch {
    return target.slice(name.length + 1);
  }
};

export const getCsrfToken = () => getCookieValue(CSRF_COOKIE_NAME);

export const buildCsrfHeaders = (headers = {}) => {
  const token = getCsrfToken();
  if (!token) return { ...headers };

  return {
    ...headers,
    "x-csrf-token": token,
  };
};
