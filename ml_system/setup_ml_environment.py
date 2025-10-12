#!/usr/bin/env python3
"""
Setup script for Madison Metro ML Environment
Installs dependencies and sets up the ML system
"""

import subprocess
import sys
import os
import platform
from pathlib import Path

def run_command(command, description):
    """Run a command and handle errors"""
    print(f"🔄 {description}...")
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        print(f"✅ {description} completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {description} failed: {e}")
        print(f"Error output: {e.stderr}")
        return False

def check_cuda():
    """Check CUDA availability"""
    print("🔍 Checking CUDA availability...")
    try:
        import torch
        if torch.cuda.is_available():
            print(f"✅ CUDA is available! Found {torch.cuda.device_count()} GPU(s)")
            for i in range(torch.cuda.device_count()):
                gpu_name = torch.cuda.get_device_name(i)
                print(f"   GPU {i}: {gpu_name}")
            return True
        else:
            print("⚠️  CUDA is not available. Will use CPU.")
            return False
    except ImportError:
        print("⚠️  PyTorch not installed yet. Will check after installation.")
        return False

def install_pytorch_gpu():
    """Install PyTorch with CUDA support"""
    print("🚀 Installing PyTorch with CUDA support...")
    
    # Check if we're on Windows
    if platform.system() == "Windows":
        # Install PyTorch with CUDA 12.1 for Windows
        command = "pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121"
    else:
        # Install PyTorch with CUDA 12.1 for Linux
        command = "pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121"
    
    return run_command(command, "Installing PyTorch with CUDA")

def install_requirements():
    """Install other requirements"""
    # Try essential requirements first
    requirements_file = Path(__file__).parent / "requirements" / "essential.txt"
    
    if requirements_file.exists():
        # Use quotes around the path to handle spaces
        command = f'pip install -r "{requirements_file}"'
        return run_command(command, "Installing essential ML requirements")
    else:
        print("❌ Requirements file not found!")
        return False

def create_directories():
    """Create necessary directories"""
    print("📁 Creating directory structure...")
    
    directories = [
        "data/processed",
        "data/features", 
        "data/validation",
        "models/saved",
        "training/experiments",
        "inference/api",
        "evaluation/reports",
        "notebooks",
        "tests"
    ]
    
    for directory in directories:
        Path(directory).mkdir(parents=True, exist_ok=True)
        print(f"   Created: {directory}")
    
    print("✅ Directory structure created")

def setup_wandb():
    """Setup Weights & Biases"""
    print("🔧 Setting up Weights & Biases...")
    print("   Please run 'wandb login' to authenticate with your account")
    print("   Get your API key from: https://wandb.ai/authorize")
    return True

def test_installation():
    """Test the installation"""
    print("🧪 Testing installation...")
    
    try:
        import torch
        import pandas as pd
        import numpy as np
        import sklearn
        import fastapi
        import wandb
        
        print("✅ All core packages imported successfully")
        
        # Test CUDA
        if torch.cuda.is_available():
            print(f"✅ CUDA test passed - GPU: {torch.cuda.get_device_name(0)}")
        else:
            print("⚠️  CUDA not available - using CPU")
        
        return True
        
    except ImportError as e:
        print(f"❌ Import test failed: {e}")
        return False

def main():
    """Main setup function"""
    print("🚀 Setting up Madison Metro ML Environment")
    print("=" * 50)
    
    # Check Python version
    python_version = sys.version_info
    if python_version < (3, 8):
        print("❌ Python 3.8+ is required!")
        return False
    
    print(f"✅ Python {python_version.major}.{python_version.minor}.{python_version.micro}")
    
    # Create directories
    create_directories()
    
    # Install PyTorch with CUDA
    if not install_pytorch_gpu():
        print("❌ PyTorch installation failed!")
        return False
    
    # Install other requirements
    if not install_requirements():
        print("❌ Requirements installation failed!")
        return False
    
    # Check CUDA
    check_cuda()
    
    # Setup W&B
    setup_wandb()
    
    # Test installation
    if not test_installation():
        print("❌ Installation test failed!")
        return False
    
    print("\n🎉 ML Environment setup completed successfully!")
    print("\n📋 Next steps:")
    print("1. Run 'wandb login' to authenticate")
    print("2. Let your data collection run for at least 1 week")
    print("3. Run 'python train_delay_predictor.py' to start training")
    print("4. Check the generated models in 'models/saved/'")
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
