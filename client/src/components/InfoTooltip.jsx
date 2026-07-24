import React, { useState } from 'react';
import { Info } from 'lucide-react';

function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);

  return (
    <span 
      style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '5px', position: 'relative', cursor: 'help' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <Info size={14} style={{ color: 'var(--safehill-blue)' }} />
      {show && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: '8px',
          padding: '8px 12px',
          backgroundColor: '#1e293b',
          color: '#f8fafc',
          fontSize: '0.8rem',
          borderRadius: '6px',
          whiteSpace: 'nowrap',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          zIndex: 1000,
          fontWeight: 'normal'
        }}>
          {text}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            borderWidth: '5px',
            borderStyle: 'solid',
            borderColor: '#1e293b transparent transparent transparent'
          }} />
        </div>
      )}
    </span>
  );
}

export default InfoTooltip;
