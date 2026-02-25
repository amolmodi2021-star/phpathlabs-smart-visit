const CREDENTIALS = { userId: "PHPATHLABS", password: "PHPL6699" };
const AUTH_KEY = "ph_pathlabs_auth";

export function isAuthenticated(): boolean {
  return localStorage.getItem(AUTH_KEY) === "true";
}

export function login(userId: string, password: string): boolean {
  if (userId === CREDENTIALS.userId && password === CREDENTIALS.password) {
    localStorage.setItem(AUTH_KEY, "true");
    return true;
  }
  return false;
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
}
