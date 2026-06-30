#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn initialize(env: Env) -> Symbol {
        env.events().publish((symbol_short!(init),), symbol_short!(ok));
        symbol_short!(ready)
    }
}
