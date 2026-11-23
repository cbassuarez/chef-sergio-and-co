// Single-threaded conservative gravity/lubrication solver. No OpenMP or GPU.
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

struct State { int frame; double time, volume, x,y,z,vx,vy,vz,tx,ty,tz; };
int main(int argc,char**argv){try{
 if(argc!=5)throw std::runtime_error("Need source.tsv heights.bin ledger.tsv statistics.txt");
 std::ifstream input(argv[1]);int frames,nx,ny;double dx,xmin,ymin,nu,g,sigma,dtmax;
 input>>frames>>nx>>ny>>dx>>xmin>>ymin>>nu>>g>>sigma>>dtmax;
 if(!input||frames<2||nx<3||ny<3||nu<=0||dx<=0)throw std::runtime_error("Invalid configuration");
 std::vector<State> states(frames);for(auto&s:states)input>>s.frame>>s.time>>s.volume>>s.x>>s.y>>s.z>>s.vx>>s.vy>>s.vz>>s.tx>>s.ty>>s.tz;
 if(!input)throw std::runtime_error("Incomplete source ledger");
 const int cells=nx*ny;const double area=dx*dx,K=g/(3*nu);
 std::vector<double> h(cells,0),delta(cells),fx(ny*(nx-1)),fy((ny-1)*nx);
 std::ofstream binary(argv[2],std::ios::binary),ledger(argv[3]);ledger<<std::setprecision(17);
 ledger<<"frame\ttime_s\ttarget_m3\tmeasured_m3\terror_m3\tmaximum_height_m\tminimum_height_m\tsteps\n";
 double target=0,max_error=0,min_seen=0,min_dt=1,max_roundoff=0;long long total_steps=0;
 auto snapshot=[&](int f,int steps){
   double sum=0,correction=0,maxh=0,minh=1;int largest=0;
   for(int i=0;i<cells;++i){double y=h[i]-correction,t=sum+y;correction=(t-sum)-y;sum=t;if(h[i]>maxh){maxh=h[i];largest=i;}minh=std::min(minh,h[i]);}
   const double error=sum*area-target;max_error=std::max(max_error,std::abs(error));
   // This corrects floating-point summation only, never source/model error.
   if(std::abs(error)>1e-13)throw std::runtime_error("Conservative volume drift exceeds roundoff allowance");
   if(target>0){h[largest]-=error/area;max_roundoff=std::max(max_roundoff,std::abs(error));}
   sum=0;correction=0;for(double value:h){double y=value-correction,t=sum+y;correction=(t-sum)-y;sum=t;}
   binary.write(reinterpret_cast<const char*>(h.data()),cells*sizeof(double));
   ledger<<states[f].frame<<'\t'<<states[f].time<<'\t'<<target<<'\t'<<sum*area<<'\t'<<sum*area-target<<'\t'<<maxh<<'\t'<<minh<<'\t'<<steps<<'\n';
 };
 snapshot(0,0);
 for(int f=1;f<frames;++f){
   const auto&a=states[f-1];const auto&b=states[f];const double interval=b.time-a.time,rate=b.volume/interval;
   if(interval<=0||b.volume<0)throw std::runtime_error("Invalid interval/source volume");
   double elapsed=0;int frame_steps=0;
   while(elapsed<interval-1e-13){
     double maxh=*std::max_element(h.begin(),h.end());
     double candidate=std::min(dtmax,interval-elapsed);
     // Even depositing all interval source in one cell cannot exceed this
     // height bound. dt <= .2 dx² / Dmax makes every update coefficient
     // nonnegative in 2D; no clipping or negative-height repair is required.
     const double bound=maxh+rate*candidate/area;
     const double Dmax=K*bound*bound*bound;
     double dt=std::min(candidate,Dmax>0?.20*dx*dx/Dmax:candidate);
     if(!(dt>1e-12))throw std::runtime_error("CFL step underflow");
     min_dt=std::min(min_dt,dt);const double q=(elapsed+.5*dt)/interval;
     auto lerp=[&](double u,double v){return u+(v-u)*q;};
     const double z=std::max(0.,lerp(a.z,b.z));
     const double vx=lerp(a.vx+a.tx,b.vx+b.tx),vy=lerp(a.vy+a.ty,b.vy+b.ty),vz=lerp(a.vz+a.tz,b.vz+b.tz);
     const double flight=(vz+std::sqrt(vz*vz+2*g*z))/g;
     const double sx=lerp(a.x,b.x)+vx*flight,sy=lerp(a.y,b.y)+vy*flight;
     if(rate>0&&(sx<xmin||sx>xmin+nx*dx||sy<ymin||sy>ymin+ny*dx))throw std::runtime_error("Actual impact outside domain");
     const int ix0=std::max(0,int(std::floor((sx-4*sigma-xmin)/dx))),ix1=std::min(nx-1,int(std::ceil((sx+4*sigma-xmin)/dx)));
     const int iy0=std::max(0,int(std::floor((sy-4*sigma-ymin)/dx))),iy1=std::min(ny-1,int(std::ceil((sy+4*sigma-ymin)/dx)));
     std::vector<double>wx(std::max(0,ix1-ix0+1)),wy(std::max(0,iy1-iy0+1));double sumx=0,sumy=0;
     for(int x=ix0;x<=ix1;++x){double d=(xmin+(x+.5)*dx-sx)/sigma;sumx+=(wx[x-ix0]=std::exp(-.5*d*d));}
     for(int y=iy0;y<=iy1;++y){double d=(ymin+(y+.5)*dx-sy)/sigma;sumy+=(wy[y-iy0]=std::exp(-.5*d*d));}
     auto deposit=[&](){if(rate<=0)return;const double scale=.5*rate*dt/(area*sumx*sumy);for(int y=iy0;y<=iy1;++y)for(int x=ix0;x<=ix1;++x)h[y*nx+x]+=scale*wy[y-iy0]*wx[x-ix0];};
     deposit();
     std::fill(delta.begin(),delta.end(),0.);
     for(int y=0;y<ny;++y)for(int x=0;x<nx-1;++x){int i=y*nx+x;double u=h[i],v=h[i+1];double flux=.5*K*(u*u*u+v*v*v)*(u-v)/dx;double transfer=dt*flux/dx;delta[i]-=transfer;delta[i+1]+=transfer;}
     for(int y=0;y<ny-1;++y)for(int x=0;x<nx;++x){int i=y*nx+x;double u=h[i],v=h[i+nx];double flux=.5*K*(u*u*u+v*v*v)*(u-v)/dx;double transfer=dt*flux/dx;delta[i]-=transfer;delta[i+nx]+=transfer;}
     for(int i=0;i<cells;++i){h[i]+=delta[i];if(h[i]<-1e-18)throw std::runtime_error("Positivity violation");min_seen=std::min(min_seen,h[i]);}
     deposit();elapsed+=dt;++frame_steps;++total_steps;
   }
   target+=b.volume;snapshot(f,frame_steps);
   if(f%24==0)std::cerr<<"film frame "<<b.frame<<"/"<<frames<<" steps "<<total_steps<<'\n';
 }
 std::ofstream stats(argv[4]);stats<<std::setprecision(17)<<"steps "<<total_steps<<"\nminimum_dt "<<min_dt<<"\nminimum_height "<<min_seen<<"\nmaximum_roundoff_error_m3 "<<max_error<<"\nmaximum_roundoff_closure_m3 "<<max_roundoff<<"\nfinal_volume_m3 "<<target<<'\n';
 return 0;
}catch(const std::exception&e){std::cerr<<"THINFILM_ERROR "<<e.what()<<'\n';return 1;}}
