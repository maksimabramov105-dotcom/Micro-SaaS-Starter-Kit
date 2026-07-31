/**
 * jest-dom matcher types.
 *
 * jest.setup.js imports '@testing-library/jest-dom' at runtime, but tsc has no
 * way to know that, so `.tsx` tests using toBeInTheDocument() and friends failed
 * to typecheck the moment the first component test appeared. One reference here
 * covers every test file.
 */
import '@testing-library/jest-dom'
