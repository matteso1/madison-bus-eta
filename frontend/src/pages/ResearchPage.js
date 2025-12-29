import React from 'react';
import { useNavigate } from 'react-router-dom';
import DataExplorer from './DataExplorer';
import { ArrowLeft, GraduationCap } from 'lucide-react';
import './ResearchPage.css';

function ResearchPage() {
    const navigate = useNavigate();

    return (
        <div className="research-page">
            {/* Header */}
            <div className="research-header">
                <button className="back-to-app" onClick={() => navigate('/')}>
                    <ArrowLeft size={20} />
                    Back to App
                </button>

                <div className="research-title-section">
                    <GraduationCap size={48} strokeWidth={1.5} className="research-icon" />
                    <div>
                        <h1 className="research-title">Research Dashboard</h1>
                        <p className="research-subtitle">
                            Machine Learning Analysis of Madison Metro Transit Data
                        </p>
                    </div>
                </div>

                <div className="research-info">
                    <div className="info-badge">
                        <strong>204,380</strong> transit records analyzed
                    </div>
                    <div className="info-badge">
                        <strong>21.3%</strong> improvement over API baseline
                    </div>
                    <div className="info-badge">
                        XGBoost ML Model
                    </div>
                </div>
            </div>

            {/* Data Explorer Content */}
            <div className="research-content">
                <DataExplorer />
            </div>

            {/* Footer */}
            <div className="research-footer">
                <p>
                    This research dashboard demonstrates advanced data analytics and machine learning
                    techniques applied to public transit optimization. Built for graduate school portfolio.
                </p>
            </div>
        </div>
    );
}

export default ResearchPage;
