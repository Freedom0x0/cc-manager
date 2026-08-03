//! v1.2 cc-pet: Hopet-like embedded desktop pet module
//!
//! Spec: docs/superpowers/specs/2026-08-03-cc-pet-integration-design.md

pub mod state;
pub mod daemon;
pub mod install;
pub mod http;

#[cfg(test)]
mod install_test;
#[cfg(test)]
mod daemon_test;
#[cfg(test)]
mod http_test;
