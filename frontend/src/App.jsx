import React, { useState, useEffect, useRef } from 'react';

export default function App() {
  const itemId = 1; // Direct reference to our Vintage Arcade Machine
  const [item, setItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [bidAmount, setBidAmount] = useState('');
  const [bidderName, setBidderName] = useState('');
  const [statusMessage, setStatusMessage] = useState({ text: '', isError: false });
  const [isConnected, setIsConnected] = useState(false);
  
  const wsRef = useRef(null);

  const fetchCurrentState = async () => {
    try {
      const response = await fetch(`/api/items/${itemId}`);
      if (!response.ok) throw new Error('Failed to fetch state data.');
      const data = await response.json();
      setItem(data.item);
      setHistory(data.history);
    } catch (err) {
      console.error('State reconciliation failure:', err);
    }
  };

  useEffect(() => {
    fetchCurrentState();

    function connectWebSocket() {
      // Point the WebSocket connection directly to our backend server port
      const wsUrl = 'ws://localhost:5000';
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        fetchCurrentState();
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.event === 'NEW_BID' && Number(data.item_id) === Number(itemId)) {
          setItem(prev => prev ? { ...prev, current_highest_bid: data.highest_bid } : null);
          setHistory(prev => [
            { bidder_name: data.bidder, amount: data.highest_bid, created_at: new Date().toISOString() },
            ...prev
          ]);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setTimeout(() => {
          connectWebSocket();
        }, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws.close();
      };
    }

    connectWebSocket();

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [itemId]);

  const handlePlaceBid = async (e) => {
    e.preventDefault();
    setStatusMessage({ text: '', isError: false });

    if (!bidderName.trim() || !bidAmount) {
      setStatusMessage({ text: 'Please populate your identity and target value.', isError: true });
      return;
    }

    const numericAmount = parseFloat(bidAmount);
    if (item && numericAmount <= item.current_highest_bid) {
      setStatusMessage({ text: `Your bid must exceed the current highest value ($${item.current_highest_bid}).`, isError: true });
      return;
    }

    try {
      const response = await fetch('/api/bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, bidderName, amount: numericAmount })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Server rejected transaction.');

      setStatusMessage({ text: 'Bid accepted by server consensus!', isError: false });
      setBidAmount('');
    } catch (err) {
      setStatusMessage({ text: err.message, isError: true });
    }
  };

  if (!item) return <div style={{ padding: '2rem', textAlign: 'center' }}>Syncing auction parameters...</div>;

  return (
    <div style={{ maxWidth: '600px', margin: '2rem auto', fontFamily: 'sans-serif', padding: '1rem', border: '1px solid #ccc', borderRadius: '8px' }}>
      <h2>{item.title}</h2>
      <p>{item.description}</p>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}>
        <span>Status:</span>
        <span style={{ color: isConnected ? 'green' : 'red', fontWeight: 'bold' }}>
          {isConnected ? '● Connected to Stream' : '○ Offline (Reconnecting...)'}
        </span>
      </div>

      <div style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
        <h3>Current Highest Bid: <span style={{ color: '#007bff' }}>\${Number(item.current_highest_bid).toFixed(2)}</span></h3>
      </div>

      <form onSubmit={handlePlaceBid} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '1.5rem' }}>
        <input 
          type="text" 
          placeholder="Your Name" 
          value={bidderName} 
          onChange={e => setBidderName(e.target.value)}
          style={{ padding: '8px', fontSize: '1rem' }}
        />
        <input 
          type="number" 
          step="0.01" 
          placeholder={`Must be > $${Number(item.current_highest_bid).toFixed(2)}`} 
          value={bidAmount} 
          onChange={e => setBidAmount(e.target.value)}
          style={{ padding: '8px', fontSize: '1rem' }}
        />
        <button type="submit" style={{ padding: '10px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem' }}>
          Submit Secure Bid
        </button>
      </form>

      {statusMessage.text && (
        <div style={{ padding: '10px', borderRadius: '4px', marginBottom: '1rem', backgroundColor: statusMessage.isError ? '#f8d7da' : '#d4edda', color: statusMessage.isError ? '#721c24' : '#155724' }}>
          {statusMessage.text}
        </div>
      )}

      <h3>Bid History Log</h3>
      <ul style={{ listStyleType: 'none', paddingLeft: 0, maxHeight: '200px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '4px' }}>
        {history.map((log, index) => (
          <li key={index} style={{ padding: '8px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
            <strong>{log.bidder_name}</strong>
            <span style={{ color: '#28a745', fontWeight: 'bold' }}>\${Number(log.amount).toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
