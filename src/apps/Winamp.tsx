import React from 'react';

export const Winamp: React.FC = () => {
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#000' }}>
      <iframe
        src="/programs/winamp/index.html"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
        }}
        title="Winamp"
        sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-downloads"
        allow="autoplay"
      />
    </div>
  );
};

export default Winamp;
