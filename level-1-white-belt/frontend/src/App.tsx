import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const project = {
  "dir": "05-directremit",
  "title": "DirectRemit",
  "short": "Remit",
  "useCase": "low cost remittance payments",
  "audience": "global senders",
  "primary": "#073b4c",
  "secondary": "#06d6a0",
  "action": "Send remittance"
};

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

const pages = [
  { id: 'overview', label: 'Overview' },
  { id: 'wallet', label: 'Signatures' },
  { id: 'send', label: 'Send remittance' },
  { id: 'activity', label: 'Ledger' },
] as const;

const checklist = [
  { title: 'Wallet Integration', desc: 'Secure Freighter cryptographic handshake.' },
  { title: 'Horizon Ledger Sync', desc: 'Dynamic balance check and account synchronization.' },
  { title: 'Payment Seal', desc: 'Commit payloads directly into transaction memo fields.' },
  { title: 'Responsive Workspace', desc: 'Optimized layout built with custom luxury color tokens.' },
];

type PageId = (typeof pages)[number]['id'];
type FlowState = 'idle' | 'connecting' | 'connected' | 'loading' | 'submitting' | 'success' | 'failure';

function readValue(value: any, keys: string[]) {
  if (value && typeof value === 'object') {
    for (const key of keys) {
      if (key in value) return value[key];
    }
  }
  return value;
}

async function loadFreighter() {
  return await import('@stellar/freighter-api') as any;
}

async function getFreighterPublicKey() {
  const freighter = await loadFreighter();
  const connectedResult = freighter.isConnected ? await freighter.isConnected() : true;
  const installed = Boolean(readValue(connectedResult, ['isConnected', 'isAvailable', 'result']));
  if (!installed && !freighter.getAddress && !freighter.getPublicKey) {
    throw new Error('Freighter wallet not found. Please install the Freighter extension.');
  }

  if (freighter.setAllowed) await freighter.setAllowed();
  if (freighter.requestAccess) await freighter.requestAccess();

  const addressResult = freighter.getAddress ? await freighter.getAddress() : await freighter.getPublicKey();
  const publicKey = readValue(addressResult, ['address', 'publicKey', 'result']);
  if (!publicKey) throw new Error('Wallet connection rejected.');
  return publicKey as string;
}

async function fetchNativeBalance(publicKey: string) {
  const response = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'Vault account not funded. Run Friendbot activation.' : 'Could not query balance.');
  }
  const account = await response.json();
  const native = account.balances?.find((balance: any) => balance.asset_type === 'native');
  return native?.balance ?? '0.0000000';
}

async function submitPayment(publicKey: string, destination: string, amount: string, memo: string) {
  const StellarSdk = await import('@stellar/stellar-sdk') as any;
  const freighter = await loadFreighter();
  const server = new StellarSdk.Horizon.Server(HORIZON_URL);
  const source = await server.loadAccount(publicKey);
  const fee = String(await server.fetchBaseFee());
  const builder = new StellarSdk.TransactionBuilder(source, {
    fee,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination,
      asset: StellarSdk.Asset.native(),
      amount,
    }));

  if (memo.trim()) builder.addMemo(StellarSdk.Memo.text(memo.trim().slice(0, 28)));

  const transaction = builder.setTimeout(60).build();
  const signedResult = await freighter.signTransaction(transaction.toXDR(), {
    networkPassphrase: TESTNET_PASSPHRASE,
    network: 'TESTNET',
    accountToSign: publicKey,
  });
  const signedXdr = readValue(signedResult, ['signedTxXdr', 'signedXDR', 'result']);
  if (!signedXdr) throw new Error('Freighter did not return a signed transaction.');

  const signedTransaction = new StellarSdk.Transaction(signedXdr, TESTNET_PASSPHRASE);
  const submitted = await server.submitTransaction(signedTransaction);
  return submitted.hash as string;
}

export default function App() {
  const [page, setPage] = useState<PageId>('overview');
  const [publicKey, setPublicKey] = useState('');
  const [balance, setBalance] = useState('0.0000000');
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('100');
  const [memo, setMemo] = useState('Send remittance');
  const [state, setState] = useState<FlowState>('idle');
  const [message, setMessage] = useState('DirectRemit console ready.');
  const [txHash, setTxHash] = useState('');

  const shortKey = publicKey ? `${publicKey.slice(0, 6)}...${publicKey.slice(-6)}` : 'Disconnected';

  async function connectWallet() {
    setState('connecting');
    setMessage('Initiating cryptographic handshake...');
    try {
      const key = await getFreighterPublicKey();
      setPublicKey(key);
      setState('connected');
      setMessage('Identity signature verified. Pulling balances...');
      const nextBalance = await fetchNativeBalance(key);
      setBalance(nextBalance);
      setMessage('Horizon trustless synchronization completed.');
    } catch (error: any) {
      setState('failure');
      setMessage(error.message ?? 'Handshake rejected.');
    }
  }

  function disconnectWallet() {
    setPublicKey('');
    setBalance('0.0000000');
    setTxHash('');
    setState('idle');
    setMessage('Session disconnected.');
  }

  async function refreshBalance() {
    if (!publicKey) return setMessage('Handshake Freighter before checking balances.');
    setState('loading');
    try {
      setBalance(await fetchNativeBalance(publicKey));
      setState('connected');
      setMessage('Balances updated.');
    } catch (error: any) {
      setState('failure');
      setMessage(error.message ?? 'Horizon query failed.');
    }
  }

  async function fundWallet() {
    if (!publicKey) return setMessage('Handshake Freighter first.');
    setState('loading');
    setMessage('Requesting Friendbot XLM assets...');
    try {
      const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
      if (!response.ok) throw new Error('Activation failed.');
      setBalance(await fetchNativeBalance(publicKey));
      setState('success');
      setMessage('Vault funded: 10K XLM received.');
    } catch (error: any) {
      setState('failure');
      setMessage(error.message ?? 'Activation failed.');
    }
  }

  async function initiateEscrow() {
    if (!publicKey) return setMessage('Handshake Freighter first.');
    if (!destination || !amount) return setMessage('Recipient address and lock amount required.');
    setState('submitting');
    setTxHash('');
    setMessage('Submitting signed transaction on-chain...');
    try {
      const hash = await submitPayment(publicKey, destination.trim(), amount.trim(), memo);
      setTxHash(hash);
      setState('success');
      setMessage('Transaction successfully finalized on-chain!');
      setBalance(await fetchNativeBalance(publicKey));
      setPage('activity');
    } catch (error: any) {
      setState('failure');
      setMessage(error.message ?? 'Transaction submission rejected.');
      setPage('activity');
    }
  }

  function renderPageContent() {
    switch (page) {
      case 'overview':
        return (
          <motion.div 
            key="overview"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="grid md:grid-cols-5 gap-8 items-stretch"
          >
            <div className="md:col-span-3 cyber-panel p-10 rounded flex flex-col justify-center gap-6">
              <span className="text-sm font-calligraphy text-teal-400">Ancient Trust in Digital Ledger Vaults</span>
              <h2 className="text-4xl font-bold tracking-tight text-white leading-tight">
                {project.title}
              </h2>
              <p className="text-stone-300 leading-relaxed text-base font-mono text-sm">
                Welcome to {project.title}. A secure decentralized terminal built for {project.audience} to execute {project.useCase}. Link Freighter keys, allocate test assets, and broadcast signed operations.
              </p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setPage('wallet')}
                  className="px-6 py-3.5 cyber-button"
                >
                  Authenticate keys
                </button>
                <button 
                  onClick={() => setPage('send')}
                  className="px-6 py-3.5 cyber-button"
                >
                  {project.action}
                </button>
              </div>
            </div>

            <div className="md:col-span-2 cyber-panel p-8 rounded flex flex-col justify-between gap-6">
              <h3 className="font-bold text-xl text-teal-400 border-b border-stone-800 pb-4">Specifications</h3>
              <div className="flex flex-col gap-5">
                {checklist.map((item, index) => (
                  <div className="flex gap-4 items-start" key={index}>
                    <div className="w-6 h-6 rounded bg-teal-550/10 bg-teal-950/20 text-teal-400 font-bold flex items-center justify-center text-xs shrink-0 mt-0.5 border border-teal-500/30">
                      {index + 1}
                    </div>
                    <div>
                      <h4 className="font-semibold text-stone-200 text-sm uppercase font-mono">{item.title}</h4>
                      <p className="text-xs text-stone-400 mt-1 font-mono">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        );
      case 'wallet':
        return (
          <motion.div 
            key="wallet"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="max-w-md mx-auto w-full"
          >
            <div className="cyber-panel p-10 rounded flex flex-col gap-6">
              <div className="text-center flex flex-col gap-2">
                <h2 className="text-3xl font-bold text-teal-400">Vault Handshake</h2>
                <p className="text-xs text-stone-500 font-mono">[ CONFIGURE_CONNECTION_PARAMETERS ]</p>
              </div>

              <div className="bg-black/80 border border-stone-800 p-6 rounded flex flex-col gap-4 font-mono text-xs text-stone-350">
                <div className="flex justify-between items-center border-b border-stone-900 pb-3">
                  <span className="text-stone-500 uppercase tracking-wider text-[10px]">Vault Status</span>
                  <span className={`text-[9px] font-bold px-2.5 py-1 border rounded uppercase tracking-widest ${
                    publicKey ? 'bg-teal-500/10 text-teal-400 border-teal-500/30' : 'bg-rose-950/20 text-rose-400 border-rose-500/30'
                  }`}>
                    {publicKey ? 'Synchronized' : 'Locked'}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-stone-900 pb-3">
                  <span className="text-stone-500 uppercase tracking-wider text-[10px]">Public Address</span>
                  <span className="text-[10px] bg-stone-950 px-3 py-1.5 border border-stone-800 text-teal-400/90 rounded truncate max-w-[160px]">
                    {publicKey ? publicKey : 'Disconnected'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-stone-500 uppercase tracking-wider text-[10px]">Available Collateral</span>
                  <strong className="text-base font-bold text-teal-400">
                    {balance} XLM
                  </strong>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {!publicKey ? (
                  <button 
                    onClick={connectWallet}
                    className="w-full py-4 cyber-button"
                  >
                    Handshake keys
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={refreshBalance}
                      className="py-4 cyber-button"
                    >
                      Refresh Vault
                    </button>
                    <button 
                      onClick={fundWallet}
                      className="py-4 cyber-button"
                    >
                      Activate Vault
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        );
      case 'send':
        return (
          <motion.div 
            key="send"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="max-w-md mx-auto w-full"
          >
            <div className="cyber-panel p-10 rounded flex flex-col gap-6">
              <div className="text-center flex flex-col gap-2">
                <h2 className="text-3xl font-bold text-teal-400">{project.action}</h2>
                <p className="text-xs text-stone-500 font-mono">[ BROADCAST_ON_CHAIN_TRANSACTION ]</p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-stone-400 uppercase tracking-wider font-mono">Destination Public Key</label>
                  <input 
                    value={destination} 
                    onChange={(e) => setDestination(e.target.value)} 
                    placeholder="e.g. G..."
                    className="cyber-input px-4 py-3 rounded text-xs w-full font-mono"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-stone-400 uppercase tracking-wider font-mono">Amount (XLM)</label>
                  <input 
                    type="number"
                    value={amount} 
                    onChange={(e) => setAmount(e.target.value)} 
                    className="cyber-input px-4 py-3 rounded text-sm w-full font-mono"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-stone-400 uppercase tracking-wider font-mono">Reference Memo</label>
                  <input 
                    value={memo} 
                    onChange={(e) => setMemo(e.target.value)} 
                    maxLength={28}
                    className="cyber-input px-4 py-3 rounded text-sm w-full font-mono"
                  />
                </div>
              </div>

              <button 
                onClick={initiateEscrow}
                disabled={state === 'submitting'}
                className="w-full py-4 cyber-button disabled:opacity-50"
              >
                {state === 'submitting' ? 'Submitting...' : project.action.toUpperCase()}
              </button>
            </div>
          </motion.div>
        );
      case 'activity':
        return (
          <motion.div 
            key="activity"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="max-w-md mx-auto w-full"
          >
            <div className="cyber-panel p-10 rounded flex flex-col gap-6">
              <h2 className="text-3xl font-bold text-center text-teal-400">Ledger Logs</h2>

              <div className="bg-black/80 border border-teal-500/20 p-6 rounded flex flex-col gap-4 text-center font-mono">
                <div className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center font-bold border ${
                  state === 'success' ? 'bg-teal-550/10 bg-teal-950/20 text-teal-400 border-teal-500/30' : 'bg-rose-950/20 text-rose-400 border-rose-500/30'
                }`}>
                  {state === 'success' ? '✓' : 'ℹ'}
                </div>
                <div>
                  <h3 className="font-bold text-lg text-stone-200">{state === 'success' ? 'Vault Confirmed' : 'Transactions Log'}</h3>
                  <p className="text-xs text-stone-400 mt-2 leading-relaxed">{message}</p>
                </div>
              </div>

              {txHash && (
                <div className="flex flex-col gap-2 font-mono">
                  <label className="text-[10px] uppercase tracking-wider text-stone-500 font-bold">Stellar Explorer Seal</label>
                  <a 
                    href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-[10px] p-4 rounded bg-stone-950 hover:bg-black border border-stone-800 text-teal-400 hover:text-teal-300 transition-all text-center block break-all font-mono"
                  >
                    {txHash}
                  </a>
                </div>
              )}
            </div>
          </motion.div>
        );
    }
  }

  return (
    
    <div className="min-h-screen flex relative overflow-hidden">
      
      {/* Cyberpunk Left Sidebar */}
      <aside className="w-80 cyber-sidebar flex flex-col justify-between p-8 shrink-0 z-40 relative">
        <div className="flex flex-col gap-10">
          <div className="flex items-center gap-3 border-b border-stone-800 pb-6">
            <img src="/favicon.svg" alt="Logo" className="w-10 h-10 object-contain filter drop-shadow" />
            <div>
              <h1 className="font-bold text-2xl tracking-wide text-white leading-none">
                {project.short}
              </h1>
              <span className="text-[9px] uppercase tracking-widest text-teal-400 font-bold block mt-1.5 font-mono">[ WHITE_BELT_VAULT ]</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {pages.map((item) => (
              <button
                key={item.id}
                className={`w-full px-5 py-4 text-sm font-semibold tracking-wider text-left transition-all duration-300 cyber-button ${
                  page === item.id 
                    ? 'bg-teal-500/10 text-teal-400 border-l-4 border-l-teal-500' 
                    : 'text-stone-400 hover:text-white border-transparent'
                }`}
                onClick={() => setPage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="font-mono text-[10px] text-stone-500 text-center uppercase tracking-wider">
            SYSTEM STATUS: <span className={publicKey ? "text-teal-400" : "text-rose-500"}>{publicKey ? "SYNCHRONIZED" : "OFFLINE"}</span>
          </div>
          <button 
            onClick={publicKey ? disconnectWallet : connectWallet}
            className="w-full py-3.5 cyber-button"
          >
            {publicKey ? shortKey : 'HANDSHAKE KEYS'}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col justify-between min-h-screen z-30">
        <main className="max-w-4xl mx-auto w-full px-12 py-16 flex flex-col gap-10">
          
          {/* Status Message Display */}
          <div className="cyber-panel p-6 flex items-center justify-between gap-4 border-l-4 border-l-teal-500">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-teal-500 animate-ping" />
              <p className="text-sm font-mono text-stone-300">
                <span className="text-teal-400 mr-2">SYS_CONSOLE //</span> 
                {message}
              </p>
            </div>
            {publicKey && (
              <div className="text-sm font-semibold px-4 py-2 bg-teal-500/10 text-teal-400 border border-teal-500/30 rounded font-mono">
                {balance} XLM
              </div>
            )}
          </div>

          {/* Dynamic Sections */}
          <AnimatePresence mode="wait">
            {renderPageContent()}
          </AnimatePresence>
        </main>

        <footer className="py-8 border-t border-stone-900/60 text-center text-xs text-stone-600 font-mono">
          STELLAR SOROBAN PROTOCOL // CROSS-BORDER SETTLEMENT
        </footer>
      </div>
    </div>
        
  );
}
