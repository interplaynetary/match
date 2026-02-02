type ThresholdSliderProps = {
  threshold: number
  onThresholdChange: (value: number) => void
}

export function ThresholdSlider({ threshold, onThresholdChange }: ThresholdSliderProps) {
  return (
    <>
      <h2>Threshold</h2>
      <div className="slider-container">
        <label>
          <span>Match threshold</span>
          <span className="slider-value">{Math.round(threshold * 100)}%</span>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={threshold * 100}
          onChange={(e) =>
            onThresholdChange(parseInt((e.target as HTMLInputElement).value) / 100)
          }
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.7em',
            color: '#666',
            marginTop: '4px',
          }}
        >
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>
    </>
  )
}
