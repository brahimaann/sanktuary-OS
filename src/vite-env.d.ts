/// <reference types="vite/client" />

// mammoth's browser build has the same API as the main package
declare module 'mammoth/mammoth.browser' {
  import mammoth = require('mammoth');
  export = mammoth;
}
