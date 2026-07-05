fn main() {
    // With pyo3's "extension-module" feature, Python symbols are left
    // unresolved at link time (satisfied by the interpreter's dynamic
    // loader when the wheel is imported). A plain `cargo build`/`cargo
    // test` links this cdylib standalone, so it needs the linker to allow
    // those symbols to stay unresolved instead of erroring.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-undefined,dynamic_lookup");
    }
}
