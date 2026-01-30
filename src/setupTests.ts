import "@testing-library/jest-dom";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {}
  try {
    sessionStorage.clear();
  } catch {}
});
