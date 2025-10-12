#!/usr/bin/env python3
"""
Transformer-based Delay Prediction Model
Advanced architecture for predicting bus delays using attention mechanisms
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import math
from typing import Optional, Tuple

class PositionalEncoding(nn.Module):
    """Positional encoding for transformer"""
    
    def __init__(self, d_model: int, max_len: int = 5000):
        super().__init__()
        
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0).transpose(0, 1)
        
        self.register_buffer('pe', pe)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:x.size(0), :]

class MetroTransformer(nn.Module):
    """Transformer model for Madison Metro delay prediction"""
    
    def __init__(
        self,
        input_dim: int,
        d_model: int = 256,
        nhead: int = 8,
        num_layers: int = 6,
        dim_feedforward: int = 1024,
        dropout: float = 0.1,
        num_classes: int = 1,
        sequence_length: int = 24
    ):
        super().__init__()
        
        self.d_model = d_model
        self.sequence_length = sequence_length
        
        # Input projection
        self.input_projection = nn.Linear(input_dim, d_model)
        
        # Positional encoding
        self.pos_encoding = PositionalEncoding(d_model, sequence_length)
        
        # Transformer encoder
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=dim_feedforward,
            dropout=dropout,
            batch_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        
        # Output layers
        self.dropout = nn.Dropout(dropout)
        self.classifier = nn.Sequential(
            nn.Linear(d_model, d_model // 2),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(d_model // 2, d_model // 4),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(d_model // 4, num_classes)
        )
        
        # Initialize weights
        self._init_weights()
    
    def _init_weights(self):
        """Initialize model weights"""
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.xavier_uniform_(module.weight)
                if module.bias is not None:
                    nn.init.zeros_(module.bias)
            elif isinstance(module, nn.LayerNorm):
                nn.init.ones_(module.weight)
                nn.init.zeros_(module.bias)
    
    def forward(self, x: torch.Tensor, mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        """
        Forward pass
        
        Args:
            x: Input tensor of shape (batch_size, sequence_length, input_dim)
            mask: Optional attention mask
            
        Returns:
            Output tensor of shape (batch_size, num_classes)
        """
        batch_size, seq_len, _ = x.shape
        
        # Input projection
        x = self.input_projection(x)  # (batch_size, seq_len, d_model)
        
        # Add positional encoding
        x = x.transpose(0, 1)  # (seq_len, batch_size, d_model)
        x = self.pos_encoding(x)
        x = x.transpose(0, 1)  # (batch_size, seq_len, d_model)
        
        # Transformer encoding
        x = self.transformer(x, src_key_padding_mask=mask)
        
        # Global average pooling
        x = x.mean(dim=1)  # (batch_size, d_model)
        
        # Classification
        x = self.dropout(x)
        output = self.classifier(x)
        
        return output

class MetroLSTM(nn.Module):
    """LSTM model for delay prediction"""
    
    def __init__(
        self,
        input_dim: int,
        hidden_size: int = 128,
        num_layers: int = 3,
        dropout: float = 0.2,
        num_classes: int = 1,
        bidirectional: bool = True
    ):
        super().__init__()
        
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.bidirectional = bidirectional
        
        # LSTM layers
        self.lstm = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout if num_layers > 1 else 0,
            bidirectional=bidirectional,
            batch_first=True
        )
        
        # Output layers
        lstm_output_size = hidden_size * 2 if bidirectional else hidden_size
        self.classifier = nn.Sequential(
            nn.Linear(lstm_output_size, lstm_output_size // 2),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(lstm_output_size // 2, lstm_output_size // 4),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(lstm_output_size // 4, num_classes)
        )
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass
        
        Args:
            x: Input tensor of shape (batch_size, sequence_length, input_dim)
            
        Returns:
            Output tensor of shape (batch_size, num_classes)
        """
        # LSTM forward pass
        lstm_out, (hidden, cell) = self.lstm(x)
        
        # Use the last output
        output = lstm_out[:, -1, :]  # (batch_size, hidden_size)
        
        # Classification
        output = self.classifier(output)
        
        return output

class MetroCNN(nn.Module):
    """CNN model for delay prediction using 1D convolutions"""
    
    def __init__(
        self,
        input_dim: int,
        num_filters: int = 64,
        kernel_sizes: list = [3, 5, 7],
        dropout: float = 0.2,
        num_classes: int = 1
    ):
        super().__init__()
        
        self.conv_layers = nn.ModuleList()
        self.pool_layers = nn.ModuleList()
        
        # Create multiple convolution branches with different kernel sizes
        for kernel_size in kernel_sizes:
            conv = nn.Sequential(
                nn.Conv1d(input_dim, num_filters, kernel_size, padding=kernel_size//2),
                nn.BatchNorm1d(num_filters),
                nn.ReLU(),
                nn.Dropout(dropout),
                nn.Conv1d(num_filters, num_filters, kernel_size, padding=kernel_size//2),
                nn.BatchNorm1d(num_filters),
                nn.ReLU(),
                nn.AdaptiveAvgPool1d(1)
            )
            self.conv_layers.append(conv)
        
        # Combine features from all branches
        total_filters = num_filters * len(kernel_sizes)
        
        self.classifier = nn.Sequential(
            nn.Linear(total_filters, total_filters // 2),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(total_filters // 2, total_filters // 4),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(total_filters // 4, num_classes)
        )
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass
        
        Args:
            x: Input tensor of shape (batch_size, sequence_length, input_dim)
            
        Returns:
            Output tensor of shape (batch_size, num_classes)
        """
        # Transpose for Conv1d: (batch_size, input_dim, sequence_length)
        x = x.transpose(1, 2)
        
        # Apply convolution branches
        branch_outputs = []
        for conv_layer in self.conv_layers:
            branch_out = conv_layer(x)  # (batch_size, num_filters, 1)
            branch_out = branch_out.squeeze(-1)  # (batch_size, num_filters)
            branch_outputs.append(branch_out)
        
        # Concatenate all branches
        combined = torch.cat(branch_outputs, dim=1)  # (batch_size, total_filters)
        
        # Classification
        output = self.classifier(combined)
        
        return output

class EnsembleModel(nn.Module):
    """Ensemble of multiple models for robust predictions"""
    
    def __init__(
        self,
        input_dim: int,
        sequence_length: int = 24,
        num_classes: int = 1,
        model_configs: dict = None
    ):
        super().__init__()
        
        if model_configs is None:
            model_configs = {
                'transformer': {'d_model': 256, 'nhead': 8, 'num_layers': 6},
                'lstm': {'hidden_size': 128, 'num_layers': 3},
                'cnn': {'num_filters': 64, 'kernel_sizes': [3, 5, 7]}
            }
        
        # Initialize models
        self.transformer = MetroTransformer(
            input_dim=input_dim,
            sequence_length=sequence_length,
            num_classes=num_classes,
            **model_configs.get('transformer', {})
        )
        
        self.lstm = MetroLSTM(
            input_dim=input_dim,
            num_classes=num_classes,
            **model_configs.get('lstm', {})
        )
        
        self.cnn = MetroCNN(
            input_dim=input_dim,
            num_classes=num_classes,
            **model_configs.get('cnn', {})
        )
        
        # Ensemble weights (learnable)
        self.ensemble_weights = nn.Parameter(torch.ones(3) / 3)
        
        # Final classifier
        self.final_classifier = nn.Sequential(
            nn.Linear(num_classes * 3, num_classes * 2),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(num_classes * 2, num_classes)
        )
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass with ensemble prediction
        
        Args:
            x: Input tensor of shape (batch_size, sequence_length, input_dim)
            
        Returns:
            Output tensor of shape (batch_size, num_classes)
        """
        # Get predictions from all models
        transformer_out = self.transformer(x)
        lstm_out = self.lstm(x)
        cnn_out = self.cnn(x)
        
        # Weighted ensemble
        weights = F.softmax(self.ensemble_weights, dim=0)
        weighted_out = (
            weights[0] * transformer_out +
            weights[1] * lstm_out +
            weights[2] * cnn_out
        )
        
        # Final classification
        combined = torch.cat([transformer_out, lstm_out, cnn_out], dim=1)
        final_out = self.final_classifier(combined)
        
        return final_out

def create_model(model_type: str, input_dim: int, **kwargs) -> nn.Module:
    """Factory function to create models"""
    
    if model_type.lower() == 'transformer':
        return MetroTransformer(input_dim=input_dim, **kwargs)
    elif model_type.lower() == 'lstm':
        return MetroLSTM(input_dim=input_dim, **kwargs)
    elif model_type.lower() == 'cnn':
        return MetroCNN(input_dim=input_dim, **kwargs)
    elif model_type.lower() == 'ensemble':
        return EnsembleModel(input_dim=input_dim, **kwargs)
    else:
        raise ValueError(f"Unknown model type: {model_type}")

# Example usage and testing
if __name__ == "__main__":
    # Test models
    batch_size = 32
    sequence_length = 24
    input_dim = 25  # Number of features
    num_classes = 1
    
    # Create sample input
    x = torch.randn(batch_size, sequence_length, input_dim)
    
    # Test Transformer
    print("Testing Transformer model...")
    transformer = MetroTransformer(input_dim=input_dim, num_classes=num_classes)
    transformer_out = transformer(x)
    print(f"Transformer output shape: {transformer_out.shape}")
    
    # Test LSTM
    print("Testing LSTM model...")
    lstm = MetroLSTM(input_dim=input_dim, num_classes=num_classes)
    lstm_out = lstm(x)
    print(f"LSTM output shape: {lstm_out.shape}")
    
    # Test CNN
    print("Testing CNN model...")
    cnn = MetroCNN(input_dim=input_dim, num_classes=num_classes)
    cnn_out = cnn(x)
    print(f"CNN output shape: {cnn_out.shape}")
    
    # Test Ensemble
    print("Testing Ensemble model...")
    ensemble = EnsembleModel(input_dim=input_dim, num_classes=num_classes)
    ensemble_out = ensemble(x)
    print(f"Ensemble output shape: {ensemble_out.shape}")
    
    print("✅ All models tested successfully!")
