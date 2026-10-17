// SPDX-License-Identifier: AGPL-3.0-or-later
// AudioWorklet mínimo da sondagem do spike 4: multiplica a entrada por 0,5.
/* global AudioWorkletProcessor, registerProcessor */
class HalfGain extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel]
      const target = output[channel]
      for (let i = 0; i < target.length; i++) target[i] = source ? source[i] * 0.5 : 0
    }
    return true
  }
}

registerProcessor('half-gain', HalfGain)
